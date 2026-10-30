// Package arm — ядро АРМ закупок и продаж (контекст lines и смежные, docs/migration/ddd): строки, матрица прав, автомат
// статусов, распределение склада FIFO, «В работе», канбан снабжения, документы, печать, справочники. Перенос логики
// расширения 1С АРМЗакупокИПродаж 2.23 и команд АРМ_OData 1.3; работает без 1С на данных vitauto_app.
package arm

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Статусы строки — значения перечисления 1С Арм_СтатусыАРМ (хранятся в arm.line.status, план 5.3).
const (
	stDraft       = "Черновик"
	stInWork      = "ВРаботе"
	stOrdered     = "Заказано"
	stPaid        = "Оплачено"
	stInTransit   = "ТоварВПути"
	stAcceptance  = "Приходуется"
	stToStock     = "НаСкладе"
	stReserve     = "Резервирование"
	stAssembly    = "Комплектуется"
	stPrepared    = "Подготовлено"
	stAssembled   = "Собран"
	stShipped     = "Отгружено"
	stReturn      = "Возврат"
	stDone        = "Выполнено"
	stFinished    = "Завершено"
	stLockedBgJob = "ЗаблокированоФоном"

	opSale     = "Продажа"
	opPurchase = "Закупка"
)

// closedSale — продажи, которые не держат склад (ЗакрытыеСтатусыПродаж).
var closedSale = []string{stShipped, stDone, stFinished}

// RoleByEnum — роль интерфейса 1С (Арм_РолиИнтерфейса) → роль API.
var RoleByEnum = map[string]string{"Менеджер": "manager", "Снабжение": "supply", "Кладовщик": "storekeeper",
	"ГлавныйМеханик": "chief_mechanic", "Администратор": "admin", "Поставщик": "supplier", "Клиент": "client"}

// EnumByRole — обратное соответствие.
var EnumByRole = func() map[string]string {
	m := map[string]string{}
	for k, v := range RoleByEnum {
		m[v] = k
	}
	return m
}()

// Problem — ошибка API (application/problem+json, совместима с ApiError PWA).
type Problem struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func (p *Problem) Error() string { return p.Message }

func fail(status int, code, msg string, field ...string) error {
	p := &Problem{Status: status, Code: code, Message: msg}
	if len(field) > 0 {
		p.Field = field[0]
	}
	return p
}

// AsProblem — ошибка как Problem (иначе 500).
func AsProblem(err error) *Problem {
	var p *Problem
	if errors.As(err, &p) {
		return p
	}
	return &Problem{Status: 500, Code: "server_error", Message: err.Error()}
}

// Actor — пользователь сессии.
type Actor struct {
	UserID   uuid.UUID
	UserName string
	Login    string
	Role     string
}

// Service — операции АРМ поверх vitauto_app.
type Service struct {
	DB  *pgxpool.Pool
	Now func() time.Time

	colsOnce sync.Once
	lineCols []string
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// inTx — операция в транзакции; vitauto.user_id — автор для триггеров (уведомления).
func (s *Service) inTx(ctx context.Context, a Actor, fn func(tx pgx.Tx) error) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "select set_config('vitauto.user_id', $1, true)", nullUUID(a.UserID)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "set constraints all deferred"); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func nullUUID(u uuid.UUID) string {
	if u == uuid.Nil {
		return ""
	}
	return u.String()
}

// q — общий интерфейс пула и транзакции.
type q interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconnTag, error)
}

// pgconnTag — псевдоним, чтобы не тянуть pgconn в сигнатуры.
type pgconnTag = interface{ RowsAffected() int64 }

// updateLine — изменение строки: столбцы по именам, версия +1 (оптимистическая блокировка, события WS).
func updateLine(ctx context.Context, tx pgx.Tx, id uuid.UUID, set map[string]any) error {
	if len(set) == 0 {
		return nil
	}
	parts := make([]string, 0, len(set))
	args := []any{id}
	for col, v := range set {
		args = append(args, v)
		parts = append(parts, fmt.Sprintf("%s = $%d", pgx.Identifier{col}.Sanitize(), len(args)))
	}
	_, err := tx.Exec(ctx, "update arm.line set "+strings.Join(parts, ", ")+", version = version + 1, updated_at = now() where id = $1", args...)
	return err
}

// columns arm.line (для копирования строки целиком — СоздатьДопСтрокуПродажи, закупка из продажи).
func (s *Service) lineColumns(ctx context.Context) []string {
	s.colsOnce.Do(func() {
		rows, err := s.DB.Query(ctx, "select column_name from information_schema.columns where table_schema = 'arm' and table_name = 'line' order by ordinal_position")
		if err != nil {
			return
		}
		defer rows.Close()
		for rows.Next() {
			var c string
			_ = rows.Scan(&c)
			s.lineCols = append(s.lineCols, c)
		}
	})
	return s.lineCols
}

// copyLine — новая строка как копия src с заменой столбцов; id и ключи записи — новые.
func (s *Service) copyLine(ctx context.Context, tx pgx.Tx, src uuid.UUID, set map[string]any) (uuid.UUID, error) {
	id := uuid.Must(uuid.NewV7())
	if v, ok := set["id"].(uuid.UUID); ok {
		id = v
	}
	set["id"] = id
	if _, ok := set["onec_record_id"]; !ok {
		set["onec_record_id"] = id.String()
	}
	set["onec_key"] = "app:" + id.String()
	set["version"] = 1
	cols := s.lineColumns(ctx)
	var names, vals []string
	args := []any{src}
	for _, c := range cols {
		if c == "created_at" || c == "updated_at" {
			continue
		}
		names = append(names, pgx.Identifier{c}.Sanitize())
		if v, ok := set[c]; ok {
			args = append(args, v)
			vals = append(vals, fmt.Sprintf("$%d", len(args)))
		} else {
			vals = append(vals, pgx.Identifier{c}.Sanitize())
		}
	}
	_, err := tx.Exec(ctx, fmt.Sprintf("insert into arm.line (%s) select %s from arm.line where id = $1",
		strings.Join(names, ", "), strings.Join(vals, ", ")), args...)
	return id, err
}

// insertLine — новая строка из значений столбцов.
func insertLine(ctx context.Context, tx pgx.Tx, set map[string]any) (uuid.UUID, error) {
	id, ok := set["id"].(uuid.UUID)
	if !ok {
		id = uuid.Must(uuid.NewV7())
		set["id"] = id
	}
	if _, ok := set["onec_record_id"]; !ok {
		set["onec_record_id"] = id.String()
	}
	set["onec_key"] = "app:" + id.String()
	var names, ph []string
	var args []any
	for c, v := range set {
		args = append(args, v)
		names = append(names, pgx.Identifier{c}.Sanitize())
		ph = append(ph, fmt.Sprintf("$%d", len(args)))
	}
	_, err := tx.Exec(ctx, fmt.Sprintf("insert into arm.line (%s) values (%s)", strings.Join(names, ", "), strings.Join(ph, ", ")), args...)
	return id, err
}

// priority — Порядок новой строки номенклатуры (ПолучитьПриоритет): максимум + 1, иначе 1000.
func priority(ctx context.Context, tx pgx.Tx, nom *uuid.UUID) (float64, error) {
	var max *float64
	if err := tx.QueryRow(ctx, "select max(sort_order)::float8 from arm.line where nomenclature_id is not distinct from $1", nom).Scan(&max); err != nil {
		return 0, err
	}
	if max == nil {
		return 1000, nil
	}
	return *max + 1, nil
}

// findContract — договор контрагента по умолчанию (НайтиДоговор): действующий, не помеченный на удаление.
func findContract(ctx context.Context, tx pgx.Tx, counterparty uuid.UUID) (*uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `select c.id from ref.contract c join ref.counterparty k on k.id = c.counterparty_id
		where c.counterparty_id = $1 and not c.deleted and not coalesce(k.inactive, false) and not coalesce(c.inactive, false)
		  and (c.contract_date is null or c.contract_date <= localtimestamp)
		  and (coalesce(c.extra->>'СрокДействия', '') in ('', '0001-01-01T00:00:00') or (c.extra->>'СрокДействия')::timestamp >= localtimestamp)
		order by c.contract_date nulls last, c.name limit 1`, counterparty).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// nextNumber — номер нового документа вида: префикс последнего номера + следующий номер (НФНФ-000269).
func nextNumber(ctx context.Context, tx pgx.Tx, table string) (string, error) {
	if _, err := tx.Exec(ctx, "select pg_advisory_xact_lock(hashtext($1))", table); err != nil {
		return "", err
	}
	var last *string
	if err := tx.QueryRow(ctx, fmt.Sprintf(`select number from %s where number ~ '[0-9]+$'
		order by (substring(number from '[0-9]+$'))::bigint desc limit 1`, table)).Scan(&last); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	prefix, n, width := "НФНФ-", int64(0), 6
	if last != nil {
		i := strings.LastIndexFunc(*last, func(r rune) bool { return r < '0' || r > '9' })
		prefix = (*last)[:i+1]
		digits := (*last)[i+1:]
		width = len(digits)
		fmt.Sscan(digits, &n)
	}
	return fmt.Sprintf("%s%0*d", prefix, width, n+1), nil
}

func round2(x float64) float64 {
	if x < 0 {
		return -round2(-x)
	}
	return float64(int64(x*100+0.5000001)) / 100
}

func uptr(u uuid.UUID) *uuid.UUID { return &u }

func dayStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
}
