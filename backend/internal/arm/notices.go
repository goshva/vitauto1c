package arm

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

// noticeRoles — роли 1С, чьи уведомления видит роль API: снабжение и кладовщик — общие (D1d), администратор — все (nil).
func noticeRoles(role string) []string {
	switch role {
	case "admin":
		return nil
	case "supply", "storekeeper":
		return []string{"Снабжение", "Кладовщик"}
	}
	return []string{EnumByRole[role]}
}

// Notices — GET /notifications: до 50 непрочитанных уведомлений роли, новые первыми.
func (s *Service) Notices(ctx context.Context, a Actor) (map[string]any, error) {
	if err := requireUser(a); err != nil {
		return nil, err
	}
	roles := noticeRoles(a.Role)
	items, err := jsonRows(ctx, s.DB, `select jsonb_build_object('id', onec_record_id, 'date', to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS'), 'node', node,
		'kind', kind, 'text', text, 'customerOrderId', customer_order_id) from arm.notice
		where not is_read and ($1::text[] is null or recipient_role = any($1)) order by created_at desc limit 50`, roles)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

// ReadNotices — POST /notifications/read: прочитано — общее для роли (кто отметил, тот взял в работу).
func (s *Service) ReadNotices(ctx context.Context, a Actor, ids []string) (map[string]any, error) {
	if err := requireUser(a); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, fail(400, "bad_request", "ids: идентификаторы уведомлений", "ids")
	}
	var n int64
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `update arm.notice set is_read = true, read_by_id = $2, read_at = localtimestamp, version = version + 1, updated_at = now()
			where onec_record_id = any($1) and not is_read`, ids, nullable(a.UserID))
		n = tag.RowsAffected()
		return err
	})
	return map[string]any{"read": len(ids), "changed": n}, err
}

var _ = json.Marshal
