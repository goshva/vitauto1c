package migrate

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"golang.org/x/crypto/bcrypt"

	"vitauto/backend/internal/onec"
)

// Migrator — шаги переноса. Источник читается только на чтение.
type Migrator struct {
	Root, SourceDSN, SourceBase, TargetDSN string
	Log                                    func(string, ...any)

	meta *onec.Meta
}

func (m *Migrator) Meta() (*onec.Meta, error) {
	if m.meta == nil {
		mt, err := onec.LoadMeta(m.Root, m.SourceBase)
		if err != nil {
			return nil, err
		}
		m.meta = mt
	}
	return m.meta, nil
}

func (m *Migrator) source(ctx context.Context) (*pgx.Conn, error) {
	c, err := pgx.Connect(ctx, m.SourceDSN)
	if err != nil {
		return nil, fmt.Errorf("источник 1С: %w", err)
	}
	// только чтение: перенос никогда не пишет в базу 1С
	if _, err := c.Exec(ctx, "set session characteristics as transaction read only"); err != nil {
		c.Close(ctx)
		return nil, err
	}
	return c, nil
}

func (m *Migrator) target(ctx context.Context) (*pgxpool.Pool, error) {
	if err := ensureDatabase(ctx, m.TargetDSN); err != nil {
		return nil, err
	}
	return pgxpool.New(ctx, m.TargetDSN)
}

// ensureDatabase создаёт базу приёмника, если её нет (на экземпляре vitauto_app, не на кластере 1С).
func ensureDatabase(ctx context.Context, dsn string) error {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return err
	}
	if cfg.Port == 5433 {
		return fmt.Errorf("приёмник на порту 5433 (кластер 1С) запрещён: vitauto_app живёт на отдельном экземпляре")
	}
	name := cfg.Database
	cfg.Database = "postgres"
	c, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("приёмник: %w", err)
	}
	defer c.Close(ctx)
	var exists bool
	if err := c.QueryRow(ctx, "select exists(select 1 from pg_database where datname = $1)", name).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		_, err = c.Exec(ctx, "create database "+pgx.Identifier{name}.Sanitize()+" template template0 encoding 'UTF8' locale_provider icu icu_locale 'ru-RU' locale 'C'")
	}
	return err
}

func (m *Migrator) migrationsDir() string { return filepath.Join(m.Root, "db", "migrations") }

func (m *Migrator) gooseDB() (*sql.DB, error) {
	cfg, err := pgx.ParseConfig(m.TargetDSN)
	if err != nil {
		return nil, err
	}
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("postgres"); err != nil {
		return nil, err
	}
	return stdlib.OpenDB(*cfg), nil
}

// Gen пишет db/migrations/0002_typed.sql и db/load/typed.sql.
func (m *Migrator) Gen(ctx context.Context) error {
	meta, err := m.Meta()
	if err != nil {
		return err
	}
	src, err := m.source(ctx)
	if err != nil {
		return err
	}
	defer src.Close(ctx)
	var storages []string
	for _, t := range meta.Map.Tables {
		if t.Rule == "typed" {
			storages = append(storages, t.Storage)
		}
	}
	cols, err := SourceColumns(ctx, src, storages)
	if err != nil {
		return err
	}
	ddl, load, err := Generate(meta, cols)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(m.migrationsDir(), "0002_typed.sql"), []byte(ddl), 0o644); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(m.Root, "db", "load"), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(m.Root, "db", "load", "typed.sql"), []byte(load), 0o644); err != nil {
		return err
	}
	fields, err := GenerateArmFields(meta, cols)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(m.Root, "backend", "internal", "arm", "fields_gen.go"), []byte(fields), 0o644); err != nil {
		return err
	}
	m.Log("gen: 0002_typed.sql %d байт, typed.sql %d байт, fields_gen.go %d байт", len(ddl), len(load), len(fields))
	return nil
}

func (m *Migrator) SchemaUp(ctx context.Context) error {
	if err := ensureDatabase(ctx, m.TargetDSN); err != nil {
		return err
	}
	db, err := m.gooseDB()
	if err != nil {
		return err
	}
	defer db.Close()
	if err := goose.UpContext(ctx, db, m.migrationsDir()); err != nil {
		return err
	}
	v, err := goose.GetDBVersionContext(ctx, db)
	m.Log("schema-up: версия схемы %d", v)
	return err
}

func (m *Migrator) SchemaStatus(ctx context.Context, strict bool) error {
	db, err := m.gooseDB()
	if err != nil {
		return err
	}
	defer db.Close()
	cur, err := goose.GetDBVersionContext(ctx, db)
	if err != nil {
		return err
	}
	files, _ := filepath.Glob(filepath.Join(m.migrationsDir(), "*.sql"))
	sort.Strings(files)
	var last int64
	if len(files) > 0 {
		fmt.Sscanf(filepath.Base(files[len(files)-1]), "%d", &last)
	}
	m.Log("schema-status: применена %d, последняя %d", cur, last)
	if strict && cur != last {
		return fmt.Errorf("не применены миграции %d..%d", cur+1, last)
	}
	return nil
}

// run — запись в sys.migration_run.
func (m *Migrator) run(ctx context.Context, db *pgxpool.Pool, step string) (id string, finish func(error, map[string]any)) {
	_ = db.QueryRow(ctx, "insert into sys.migration_run (source, step) values ($1, $2) returning id::text", m.SourceBase, step).Scan(&id)
	return id, func(err error, stats map[string]any) {
		st := "ok"
		if err != nil {
			st = "failed"
			if stats == nil {
				stats = map[string]any{}
			}
			stats["error"] = err.Error()
		}
		b, _ := json.Marshal(stats)
		_, _ = db.Exec(context.Background(), "update sys.migration_run set finished_at = now(), status = $2, stats = $3 where id = $1", id, st, b)
	}
}

func lower(s string) string { return strings.ToLower(s) }

// Users — учётные записи входа для пользователей с ролью АРМ: логин — наименование пользователя; пароль задаётся
// (стенд, e2e) или остаётся пустым с требованием смены (рабочий перенос: одноразовый код администратора).
func (m *Migrator) Users(ctx context.Context, password string) error {
	db, err := m.target(ctx)
	if err != nil {
		return err
	}
	defer db.Close()
	var hash *string
	if password != "" {
		h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		s := string(h)
		hash = &s
	}
	tag, err := db.Exec(ctx, `insert into auth.credential (login, user_id, password_hash, must_change)
		select u.name, u.id, $1, $2 from auth."user" u where exists (select 1 from arm.user_role r where r.user_id = u.id) and not u.deleted
		on conflict (login) do update set password_hash = coalesce(excluded.password_hash, auth.credential.password_hash), must_change = excluded.must_change, changed_at = now()`,
		hash, hash == nil)
	if err != nil {
		return err
	}
	m.Log("users: учётных записей %d (пароль %s)", tag.RowsAffected(), map[bool]string{true: "задан", false: "не задан — смена при входе"}[hash != nil])
	return nil
}
