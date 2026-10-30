// vitauto-migrator — перенос данных 1С в vitauto_app (план, раздел 8).
//
//	vitauto-migrator gen                      # db/migrations/0002_typed.sql и db/load/typed.sql из карты таблиц
//	vitauto-migrator schema-up | schema-status [--strict]
//	vitauto-migrator extract | legacy | load | derive
//	vitauto-migrator reconcile --checks R1,R2,...|ALL
//	vitauto-migrator all                      # extract → legacy → load → derive → reconcile ALL
//
// Источник — копия 1С (--source vitauto_dev или DSN; рабочая vitauto запрещена до этапа 11 без --allow-prod),
// приёмник — VITAUTO_DB (по умолчанию postgres://postgres:postgres@localhost:5434/vitauto_app).
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"vitauto/backend/internal/migrate"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cmd := os.Args[1]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	source := fs.String("source", env("VITAUTO_SRC", "vitauto_dev"), "база 1С (имя на localhost:5433) или DSN")
	target := fs.String("target", env("VITAUTO_DB", "postgres://postgres:postgres@localhost:5434/vitauto_app"), "DSN vitauto_app")
	root := fs.String("root", "", "корень репозитория (по умолчанию — над backend)")
	checks := fs.String("checks", "ALL", "проверки reconcile через запятую")
	strict := fs.Bool("strict", false, "schema-status: ошибка, если есть неприменённые миграции")
	allowProd := fs.Bool("allow-prod", false, "разрешить рабочую базу vitauto (этап 11)")
	password := fs.String("password", "", "users: пароль учётных записей (стенд, e2e); пусто — смена при первом входе")
	_ = fs.Parse(os.Args[2:])

	r := *root
	if r == "" {
		wd, _ := os.Getwd()
		r = filepath.Dir(wd)
		if _, err := os.Stat(filepath.Join(r, "docs", "migration")); err != nil {
			r = wd
		}
	}
	src, base := sourceDSN(*source)
	if base == "vitauto" && !*allowProd {
		log.Fatal("рабочая база vitauto до этапа 11 не используется (--allow-prod)")
	}
	ctx := context.Background()
	m := &migrate.Migrator{Root: r, SourceDSN: src, SourceBase: base, TargetDSN: *target, Log: log.Printf}
	start := time.Now()
	var err error
	switch cmd {
	case "gen":
		err = m.Gen(ctx)
	case "schema-up":
		err = m.SchemaUp(ctx)
	case "schema-status":
		err = m.SchemaStatus(ctx, *strict)
	case "extract":
		err = m.Extract(ctx)
	case "legacy":
		err = m.Legacy(ctx)
	case "load":
		err = m.Load(ctx)
	case "derive":
		err = m.Derive(ctx)
	case "users":
		err = m.Users(ctx, *password)
	case "reconcile":
		err = m.Reconcile(ctx, strings.Split(*checks, ","))
	case "all":
		for _, step := range []func(context.Context) error{m.SchemaUp, m.Extract, m.Legacy, m.Load, m.Derive} {
			if err = step(ctx); err != nil {
				break
			}
		}
		if err == nil {
			err = m.Reconcile(ctx, []string{"ALL"})
		}
	default:
		usage()
	}
	if err != nil {
		log.Fatalf("%s: %v", cmd, err)
	}
	log.Printf("%s: готово за %s", cmd, time.Since(start).Round(time.Millisecond))
}

func sourceDSN(s string) (dsn, base string) {
	if strings.Contains(s, "://") {
		base = s[strings.LastIndex(s, "/")+1:]
		if i := strings.Index(base, "?"); i >= 0 {
			base = base[:i]
		}
		return s, base
	}
	return fmt.Sprintf("postgres://postgres:%s@localhost:5433/%s", env("PGPASSWORD", "postgres"), s), s
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func usage() {
	fmt.Fprintln(os.Stderr, "vitauto-migrator gen|schema-up|schema-status|extract|legacy|load|derive|reconcile|all [--source vitauto_dev] [--checks R1,R2]")
	os.Exit(2)
}
