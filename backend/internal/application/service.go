// Package application — сценарии использования (use-cases) новых фич поверх domain и vitauto_app.
// legacy-операции остались в internal/arm; здесь — возвраты (C1/C2/M16/K6), доступ (M13→A3),
// самовывоз (N4), неопознанные (M18/A1/K8), заказ-наряды (G1–G9), размещение (K2), outbox-worker.
package application

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"vitauto/backend/internal/domain"
)

// Service — операции прикладного слоя.
type Service struct {
	DB  *pgxpool.Pool
	Now func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// inTx — транзакция с автором для триггеров уведомлений.
func (s *Service) inTx(ctx context.Context, a domain.Actor, fn func(tx pgx.Tx) error) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "select set_config('vitauto.user_id', $1, true)", nullUUID(a.UserID)); err != nil {
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

func fail(status int, code, msg string, field ...string) error {
	p := &Problem{Status: status, Code: code, Message: msg}
	if len(field) > 0 {
		p.Field = field[0]
	}
	return p
}

// Problem — ошибка API (совместима с arm.Problem / ApiError PWA).
type Problem struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func (p *Problem) Error() string { return p.Message }

// AsProblem — доменная ошибка → Problem для HTTP.
func AsProblem(err error) *Problem {
	var p *Problem
	if errors.As(err, &p) {
		return p
	}
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return &Problem{Status: 404, Code: "not_found", Message: err.Error()}
	case errors.Is(err, domain.ErrVersion), errors.Is(err, domain.ErrNothingMarked):
		return &Problem{Status: 409, Code: "conflict", Message: err.Error()}
	case errors.Is(err, domain.ErrMatrixDenied):
		return &Problem{Status: 403, Code: "matrix_denied", Message: err.Error()}
	case errors.Is(err, domain.ErrNotAuthor):
		return &Problem{Status: 409, Code: "not_author", Message: err.Error()}
	case errors.Is(err, domain.ErrFieldReadonly):
		return &Problem{Status: 403, Code: "field_readonly", Message: err.Error()}
	case errors.Is(err, domain.ErrLocked):
		return &Problem{Status: 409, Code: "row_locked", Message: err.Error()}
	case errors.Is(err, domain.ErrClosed):
		return &Problem{Status: 403, Code: "matrix_denied", Message: err.Error()}
	}
	var se *domain.StateError
	if errors.As(err, &se) {
		return &Problem{Status: 409, Code: "bad_state", Message: se.Error()}
	}
	return &Problem{Status: 500, Code: "server_error", Message: err.Error()}
}

func parseID(s string) (uuid.UUID, error) {
	u, err := uuid.Parse(strings.TrimSpace(s))
	if err != nil {
		return uuid.Nil, fail(400, "bad_request", "id: UUID", "id")
	}
	return u, nil
}

// requireActor — пользователь сессии обязателен.
func requireActor(a domain.Actor) error {
	if a.UserID == uuid.Nil {
		return fail(401, "unauthorized", "Нет сессии")
	}
	return nil
}

func round2(x float64) float64 {
	if x < 0 {
		return -round2(-x)
	}
	return float64(int64(x*100+0.5000001)) / 100
}

// nextDocNumber — номер нового документа (префикс + следующий номер, как nextNumber в arm).
func nextDocNumber(ctx context.Context, tx pgx.Tx, table string) (string, error) {
	if _, err := tx.Exec(ctx, "select pg_advisory_xact_lock(hashtext($1))", table); err != nil {
		return "", err
	}
	var last *string
	if err := tx.QueryRow(ctx, fmt.Sprintf(`select number from %s where number ~ '[0-9]+$'
		order by (substring(number from '[0-9]+$'))::bigint desc limit 1`, table)).Scan(&last); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	prefix, n, width := "", int64(0), 6
	if last != nil {
		i := strings.LastIndexFunc(*last, func(r rune) bool { return r < '0' || r > '9' })
		if i < 0 {
			prefix = *last + "-"
		} else {
			prefix = (*last)[:i+1]
			digits := (*last)[i+1:]
			width = len(digits)
			fmt.Sscan(digits, &n)
		}
	}
	if prefix == "" {
		prefix = "ВН-"
	}
	return fmt.Sprintf("%s%0*d", prefix, width, n+1), nil
}
