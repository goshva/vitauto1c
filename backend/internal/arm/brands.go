package arm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Бренды номенклатуры (ТЗ 2.2). Справочник доступен всем авторизованным на чтение
// (нужен для выбора в карточке и в заявке), менять может только администратор.

var brandListRoles = []string{"manager", "supply", "storekeeper", "chief_mechanic", "admin", "client", "supplier"}
var brandEditRoles = []string{"admin"}

const brandJSON = `jsonb_build_object('id', id, 'code', coalesce(code, ''), 'name', name,
	'country', coalesce(country, ''), 'comment', coalesce(comment, ''), 'deleted', deleted)`

// BrandList — GET /directories/brands: список с поиском по названию.
func (s *Service) BrandList(ctx context.Context, a Actor, q map[string]string) ([]json.RawMessage, error) {
	if !contains(brandListRoles, a.Role) {
		return nil, fail(403, "matrix_denied", "Справочник брендов недоступен для роли «"+a.Role+"»")
	}
	return jsonRows(ctx, s.DB, `select `+brandJSON+` from ref.brand
		where ($1 or not deleted) and ($2 = '' or lower(name) like $3) order by name limit 200`,
		q["deleted"] == "true", strings.TrimSpace(q["q"]), like(q["q"]))
}

// BrandGet — один бренд.
func (s *Service) BrandGet(ctx context.Context, id string) (json.RawMessage, error) {
	iid, err := uuid.Parse(id)
	if err != nil {
		return nil, fail(404, "not_found", "Бренд не найден")
	}
	var b []byte
	err = s.DB.QueryRow(ctx, `select `+brandJSON+` from ref.brand where id = $1`, iid).Scan(&b)
	if err == pgx.ErrNoRows {
		return nil, fail(404, "not_found", "Бренд не найден")
	}
	return b, err
}

// BrandSave — POST /brands и PATCH /brands/{id}.
func (s *Service) BrandSave(ctx context.Context, a Actor, id string, b map[string]any) (json.RawMessage, error) {
	if !contains(brandEditRoles, a.Role) {
		return nil, fail(403, "matrix_denied", "Справочник брендов меняет только администратор")
	}
	str := func(k string) (string, bool) {
		v, ok := b[k]
		if !ok || v == nil {
			return "", ok
		}
		return strings.TrimSpace(fmt.Sprint(v)), true
	}
	var ref uuid.UUID
	if id != "" {
		parsed, err := uuid.Parse(id)
		if err != nil {
			return nil, fail(404, "not_found", "Бренд не найден")
		}
		ref = parsed
	}
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		set := map[string]any{}
		if v, ok := str("name"); ok {
			if v == "" {
				return fail(400, "bad_request", "Наименование бренда не заполнено", "name")
			}
			set["name"] = v
		}
		if v, ok := str("code"); ok {
			set["code"] = v
		}
		if v, ok := str("country"); ok {
			set["country"] = v
		}
		if v, ok := str("comment"); ok {
			set["comment"] = v
		}
		if ref == uuid.Nil {
			if set["name"] == nil {
				return fail(400, "bad_request", "Наименование бренда не заполнено", "name")
			}
			var dup bool
			if err := tx.QueryRow(ctx, "select exists(select 1 from ref.brand where lower(name) = lower($1) and not deleted)", set["name"]).Scan(&dup); err != nil {
				return err
			}
			if dup {
				return fail(409, "duplicate", fmt.Sprintf("Бренд «%v» уже есть", set["name"]), "name")
			}
			ref = uuid.Must(uuid.NewV7())
			set["id"], set["deleted"] = ref, false
			return insertRow(ctx, tx, "ref.brand", set)
		}
		return updateRow(ctx, tx, "ref.brand", ref, set)
	})
	if err != nil {
		return nil, err
	}
	return s.BrandGet(ctx, ref.String())
}

// BrandDelete — DELETE /brands/{id} и POST /brands/{id}/restore.
// Бренд с привязанной номенклатурой не удаляется: сначала нужно переназначить карточки.
func (s *Service) BrandDelete(ctx context.Context, a Actor, id string, restore bool) (json.RawMessage, error) {
	if !contains(brandEditRoles, a.Role) {
		return nil, fail(403, "matrix_denied", "Справочник брендов меняет только администратор")
	}
	iid, err := uuid.Parse(id)
	if err != nil {
		return nil, fail(404, "not_found", "Бренд не найден")
	}
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		if !restore {
			var used int
			if err := tx.QueryRow(ctx, `select count(*) from ref.nomenclature where brand_id = $1 and not deleted`, iid).Scan(&used); err != nil {
				return err
			}
			if used > 0 {
				return fail(409, "brand_in_use", fmt.Sprintf("Бренд используют карточки: %d. Сначала переназначьте бренд.", used))
			}
		}
		_, err := tx.Exec(ctx, `update ref.brand set deleted = $2, deleted_by_id = case when $2 then $3::uuid else null end,
			deleted_at = case when $2 then now() else null end, updated_at = now() where id = $1`, iid, !restore, nullable(a.UserID))
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.BrandGet(ctx, id)
}

// setAnalog — кросс-код: прямая парная связь «карточка ↔ карточка» (ТЗ 2.1, 7.3).
// Дерево аналогов исключено: у карточки не больше одного аналога, связи симметричны.
func setAnalog(ctx context.Context, tx pgx.Tx, ref uuid.UUID, target string) error {
	var current *uuid.UUID
	if err := tx.QueryRow(ctx, `select analog_id from ref.nomenclature where id = $1 for update`, ref).Scan(&current); err != nil {
		return err
	}
	var want *uuid.UUID
	if strings.TrimSpace(target) != "" {
		tid, err := uuid.Parse(strings.TrimSpace(target))
		if err != nil {
			return fail(400, "bad_request", "Аналог: нужен идентификатор карточки", "analogId")
		}
		if tid == ref {
			return fail(400, "bad_request", "Карточка не может быть аналогом сама себе", "analogId")
		}
		want = &tid
	}
	if current != nil && (want == nil || *want != *current) {
		if _, err := tx.Exec(ctx, `update ref.nomenclature set analog_id = null, updated_at = now() where id = $1 and analog_id = $2`, *current, ref); err != nil {
			return err
		}
	}
	if want == nil {
		_, err := tx.Exec(ctx, `update ref.nomenclature set analog_id = null, updated_at = now() where id = $1`, ref)
		return err
	}
	var partner *uuid.UUID
	if err := tx.QueryRow(ctx, `select analog_id from ref.nomenclature where id = $1 and not deleted`, *want).Scan(&partner); err != nil {
		if err == pgx.ErrNoRows {
			return fail(404, "not_found", "Карточка-аналог не найдена", "analogId")
		}
		return err
	}
	if partner != nil && *partner != ref {
		return fail(409, "analog_busy", "У выбранной карточки уже есть аналог: связь только прямая, дерево аналогов не ведём", "analogId")
	}
	// порядок важен из-за уникального индекса: сначала снять, потом поставить
	if _, err := tx.Exec(ctx, `update ref.nomenclature set analog_id = null, updated_at = now() where id = $1`, ref); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update ref.nomenclature set analog_id = $1, updated_at = now() where id = $2`, ref, *want); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `update ref.nomenclature set analog_id = $1, updated_at = now() where id = $2`, *want, ref)
	return err
}
