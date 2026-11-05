// Package application — use-cases для access_request (M13→A3) и self_pickup (N4).
package application

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"vitauto/backend/internal/domain"
)

// AccessRequestCreate — M13: пользователь запрашивает действие вне своей матрицы.
func (s *Service) AccessRequestCreate(ctx context.Context, a domain.Actor, action string, lineID string, payload map[string]any, reason string) (*AccessRequest, error) {
	if err := requireActor(a); err != nil {
		return nil, err
	}
	if action == "" {
		return nil, fail(400, "bad_request", "action: запрашиваемое действие", "action")
	}

	var reqID uuid.UUID
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		reqID = uuid.Must(uuid.NewV7())
		var line *uuid.UUID
		if lineID != "" {
			id, err := parseID(lineID)
			if err != nil {
				return err
			}
			line = &id
		}
		pj, _ := json.Marshal(payload)
		if pj == nil {
			pj = []byte("{}")
		}
		_, err := tx.Exec(ctx, `insert into auth.access_request
			(id, requester_id, requester_role, action, line_id, payload, reason, status)
			values ($1, $2, $3, $4, $5, $6, $7, 'new')`,
			reqID, a.UserID, a.Role, action, line, string(pj), reason)
		return err
	})
	return &AccessRequest{ID: reqID, Status: "new"}, err
}

// AccessRequestList — список запросов для администратора.
func (s *Service) AccessRequestList(ctx context.Context, a domain.Actor) ([]AccessRequest, error) {
	if a.Role != "admin" {
		return nil, fail(403, "matrix_denied", "Список запросов доступа — только для администратора")
	}
	rows, err := s.DB.Query(ctx, `select id, requester_id, requester_role, action, line_id, status, created_at, decided_by_id, decided_at, reason, decision_note
		from auth.access_request where not deleted order by created_at desc limit 50`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AccessRequest
	for rows.Next() {
		var ar AccessRequest
		var lineID, decidedBy uuid.NullUUID
		if err := rows.Scan(&ar.ID, &ar.RequesterID, &ar.RequesterRole, &ar.Action, &lineID,
			&ar.Status, &ar.CreatedAt, &decidedBy, &ar.DecidedAt, &ar.Reason, &ar.DecisionNote); err != nil {
			return nil, err
		}
		if lineID.Valid {
			l := lineID.UUID
			ar.LineID = &l
		}
		if decidedBy.Valid {
			ar.DecidedBy = &decidedBy.UUID
		}
		out = append(out, ar)
	}
	return out, nil
}

// AccessRequestDetail — деталь запроса.
func (s *Service) AccessRequestDetail(ctx context.Context, a domain.Actor, reqID string) (map[string]any, error) {
	if a.Role != "admin" {
		return nil, fail(403, "matrix_denied", "Детали запросов — только для администратора")
	}
	id, err := parseID(reqID)
	if err != nil {
		return nil, err
	}
	row := s.DB.QueryRow(ctx, `select id, requester_id, requester_role, action, line_id, payload, status, created_at, decided_by_id, decided_at, reason, decision_note
		from auth.access_request where id = $1 and not deleted`, id)
	var ar AccessRequest
	var lineID, decidedBy uuid.NullUUID
	var pj string
	if err := row.Scan(&ar.ID, &ar.RequesterID, &ar.RequesterRole, &ar.Action, &lineID, &pj,
		&ar.Status, &ar.CreatedAt, &decidedBy, &ar.DecidedAt, &ar.Reason, &ar.DecisionNote); err != nil {
		return nil, err
	}
	if lineID.Valid {
		l := lineID.UUID
		ar.LineID = &l
	}
	if decidedBy.Valid {
		ar.DecidedBy = &decidedBy.UUID
	}
	var payload map[string]any
	json.Unmarshal([]byte(pj), &payload)
	return map[string]any{
		"id":        ar.ID,
		"requester": ar.RequesterID,
		"role":      ar.RequesterRole,
		"action":    ar.Action,
		"lineId":    ar.LineID,
		"payload":   payload,
		"status":    ar.Status,
		"reason":    ar.Reason,
		"note":      ar.DecisionNote,
	}, nil
}

// AccessRequestDecide — A3: администратор одобряет или отклоняет запрос.
func (s *Service) AccessRequestDecide(ctx context.Context, a domain.Actor, reqID string, approved bool, note string) error {
	if a.Role != "admin" {
		return fail(403, "matrix_denied", "Только администратор может решать запросы доступа")
	}
	id, err := parseID(reqID)
	if err != nil {
		return err
	}

	status := "denied"
	if approved {
		status = "approved"
	}
	_, err = s.DB.Exec(ctx, `update auth.access_request
		set status = $1, decided_by_id = $2, decided_at = now(), decision_note = $3, updated_at = now()
		where id = $4 and not deleted`, status, a.UserID, note, id)
	return err
}

// AccessRequest — модель запроса доступа.
type AccessRequest struct {
	ID           uuid.UUID      `json:"id"`
	RequesterID  uuid.UUID      `json:"requesterId"`
	RequesterRole string        `json:"requesterRole"`
	Action       string         `json:"action"`
	LineID       *uuid.UUID     `json:"lineId,omitempty"`
	Payload      map[string]any `json:"payload,omitempty"`
	Reason       string         `json:"reason,omitempty"`
	Status       string         `json:"status"` // new, approved, denied
	DecidedBy    *uuid.UUID     `json:"decidedById,omitempty"`
	DecidedAt    *time.Time     `json:"decidedAt,omitempty"`
	DecisionNote string         `json:"decisionNote,omitempty"`
	CreatedAt    time.Time      `json:"createdAt"`
}

// SelfPickupSet — N4: установка флага самовывоза на строку (после отгрузки).
func (s *Service) SelfPickupSet(ctx context.Context, a domain.Actor, lineID string) error {
	id, err := parseID(lineID)
	if err != nil {
		return err
	}
	if err := requireActor(a); err != nil {
		return err
	}
	// Проверяем статус строки
	var status string
	err = s.DB.QueryRow(ctx, "select status from arm.line where id = $1 and not deleted", id).Scan(&status)
	if err != nil {
		if err == pgx.ErrNoRows {
			return fail(404, "not_found", "Строка не найдена")
		}
		return err
	}
	if status != string(domain.StatusShipped) {
		return fail(409, "bad_state", "Самовывоз возможен только из статуса «Отгружено»")
	}
	_, err = s.DB.Exec(ctx, `update arm.line set self_pickup = true, updated_at = now() where id = $1`, id)
	return err
}
