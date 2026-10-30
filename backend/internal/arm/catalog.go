package arm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func jsonRows(ctx context.Context, db querier, sql string, args ...any) ([]json.RawMessage, error) {
	rows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func like(q string) string { return "%" + strings.ToLower(strings.TrimSpace(q)) + "%" }

// Directory — GET /directories/{name}: списки для полей «выбор».
func (s *Service) Directory(ctx context.Context, name string, q map[string]string) ([]json.RawMessage, error) {
	named := "jsonb_build_object('id', id, 'name', name)"
	switch name {
	case "counterparties":
		return jsonRows(ctx, s.DB, "select "+named+" from ref.counterparty where not deleted and not coalesce(is_folder, false) and ($1 = '' or lower(name) like $2) order by name limit 50", q["q"], like(q["q"]))
	case "contracts":
		if q["ownerId"] == "" {
			return []json.RawMessage{}, nil
		}
		return jsonRows(ctx, s.DB, "select "+named+" from ref.contract where not deleted and counterparty_id = $1::uuid order by name", q["ownerId"])
	case "nomenclature":
		return jsonRows(ctx, s.DB, `select jsonb_build_object('id', n.id, 'name', n.name, 'article', coalesce(n.article, ''), 'code', coalesce(n.ext_code, ''), 'unit', coalesce(u.name, ''))
			from ref.nomenclature n left join ref.unit u on u.id = n.unit_id
			where not n.deleted and not coalesce(n.is_folder, false) and ($1 = '' or lower(n.name) like $2 or lower(n.article) like $2) order by n.name limit 50`, q["q"], like(q["q"]))
	case "batches":
		return jsonRows(ctx, s.DB, "select "+named+" from ref.batch where not deleted and ($1 = '' or owner_id = $1::uuid) limit 100", q["nomenclatureId"])
	case "service-types":
		return jsonRows(ctx, s.DB, "select "+named+" from ref.service_kind where not deleted order by name")
	case "payment-forms":
		return jsonRows(ctx, s.DB, "select "+named+" from ref.payment_form where not deleted order by name")
	case "units":
		return jsonRows(ctx, s.DB, "select "+named+" from ref.unit where not deleted order by name")
	case "car-models":
		return jsonRows(ctx, s.DB, "select "+named+" from ref.car_model where not deleted and not coalesce(is_folder, false) and ($1 = '' or lower(name) like $2) order by name limit 100", q["q"], like(q["q"]))
	case "car-groups":
		return jsonRows(ctx, s.DB, "select "+named+" from ref.car where not deleted and coalesce(is_folder, false) order by name")
	case "warehouses":
		return jsonRows(ctx, s.DB, "select jsonb_build_object('id', id, 'name', name, 'main', is_main) from ref.warehouse where not deleted and is_warehouse order by is_main desc, name")
	case "cells":
		return jsonRows(ctx, s.DB, "select jsonb_build_object('id', id, 'name', code, 'warehouseId', warehouse_id) from ref.storage_cell where not deleted and ($1 = '' or warehouse_id = $1::uuid) order by code", q["warehouseId"])
	}
	return nil, fail(404, "not_found", "Справочник: counterparties, contracts, nomenclature, batches, service-types, payment-forms, units, car-models, car-groups, warehouses, cells")
}

// CatalogEdit — кто меняет разделы «Товары», «Услуги», «Машины».
var CatalogEdit = map[string][]string{"goods": {"admin", "manager", "storekeeper"}, "services": {"admin", "manager", "chief_mechanic"}, "cars": {"admin", "manager", "chief_mechanic"}}

var nomKind = map[string]string{"goods": "Запас", "services": "Услуга"}

const retailPrice = "Розничная цена"

const nomItem = `jsonb_build_object('id', n.id, 'code', coalesce(n.code, ''), 'name', n.name, 'fullName', coalesce(nullif(n.full_name, ''), n.name),
	'article', coalesce(n.article, ''), 'unit', case when u.id is null then null else jsonb_build_object('id', u.id, 'name', u.name) end,
	'comment', coalesce(n.comment, ''), 'deleted', n.deleted, 'type', n.kind,
	'price', (select p.price from ref.price p join ref.price_type t on t.id = p.price_type_id where t.name = 'Розничная цена' and p.nomenclature_id = n.id order by p.period desc limit 1),
	'priceDate', (select to_char(p.period, 'YYYY-MM-DD') from ref.price p join ref.price_type t on t.id = p.price_type_id where t.name = 'Розничная цена' and p.nomenclature_id = n.id order by p.period desc limit 1))`

const carItem = `jsonb_build_object('id', c.id, 'code', coalesce(c.code, ''), 'name', c.name, 'vin', coalesce(c.vin, ''),
	'year', case when c.year is null then null else extract(year from c.year)::int end,
	'model', case when m.id is null then null else jsonb_build_object('id', m.id, 'name', m.name) end,
	'group', case when g.id is null then null else jsonb_build_object('id', g.id, 'name', g.name) end,
	'plate', coalesce((select a.value_value #>> '{}' from ref.car_attribute a where a.car_id = c.id and a.attr_kind = 'ГосНомер' order by a.period desc limit 1), ''),
	'chassis', coalesce(c.chassis_no, ''), 'engine', coalesce(c.engine_no, ''), 'comment', coalesce(c.comment, ''), 'deleted', c.deleted)`

// CatalogList — GET /catalog/{kind}.
func (s *Service) CatalogList(ctx context.Context, a Actor, kind string, q map[string]string) (map[string]any, error) {
	limit, _ := strconv.Atoi(q["limit"])
	if limit <= 0 || limit > 200 {
		limit = min(max(limit, 50), 200)
	}
	skip, _ := strconv.Atoi(q["skip"])
	deleted := q["deleted"] == "true"
	var items []json.RawMessage
	var err error
	if kind == "cars" {
		items, err = jsonRows(ctx, s.DB, `select `+carItem+` from ref.car c left join ref.car_model m on m.id = c.model_id left join ref.car g on g.id = c.parent_id
			where not coalesce(c.is_folder, false) and ($1 or not c.deleted) and ($2 = '' or c.parent_id = $2::uuid)
			  and ($3 = '' or lower(c.name) like $4 or lower(c.vin) like $4) order by c.name limit $5 offset $6`, deleted, q["groupId"], q["q"], like(q["q"]), limit+1, skip)
	} else {
		items, err = jsonRows(ctx, s.DB, `select `+nomItem+` from ref.nomenclature n left join ref.unit u on u.id = n.unit_id
			where not coalesce(n.is_folder, false) and ($1 or not n.deleted) and n.kind = $2
			  and ($3 = '' or lower(n.name) like $4 or lower(n.article) like $4) order by n.name limit $5 offset $6`, deleted, nomKind[kind], q["q"], like(q["q"]), limit+1, skip)
	}
	if err != nil {
		return nil, err
	}
	var next any
	if len(items) > limit {
		items, next = items[:limit], skip+limit
	}
	return map[string]any{"items": items, "nextSkip": next, "canEdit": contains(CatalogEdit[kind], a.Role)}, nil
}

// CatalogItem — GET /catalog/{kind}/{id} (услуги — с ценами авторабот по моделям).
func (s *Service) CatalogItem(ctx context.Context, kind, id string) (json.RawMessage, error) {
	iid, err := uuid.Parse(id)
	if err != nil {
		return nil, fail(404, "not_found", "Элемент не найден")
	}
	var b []byte
	if kind == "cars" {
		err = s.DB.QueryRow(ctx, `select `+carItem+` from ref.car c left join ref.car_model m on m.id = c.model_id left join ref.car g on g.id = c.parent_id where c.id = $1`, iid).Scan(&b)
	} else {
		err = s.DB.QueryRow(ctx, `select `+nomItem+` || case when $2 = 'services' then jsonb_build_object('modelPrices', coalesce((
			select jsonb_agg(jsonb_build_object('model', case when m.id is null then null else jsonb_build_object('id', m.id, 'name', m.name) end,
				'price', x.price, 'date', to_char(x.period, 'YYYY-MM-DD')) order by x.price, m.name)
			from (select distinct on (model_id) model_id, price, period from ref.labor_price where nomenclature_id = n.id and coalesce(active, true) order by model_id, period desc) x
			left join ref.car_model m on m.id = x.model_id), '[]'::jsonb)) else '{}'::jsonb end
			from ref.nomenclature n left join ref.unit u on u.id = n.unit_id where n.id = $1`, iid, kind).Scan(&b)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail(404, "not_found", "Элемент не найден")
	}
	return b, err
}

// CatalogSave — POST /catalog/{kind} и PATCH /catalog/{kind}/{id}: элемент, цена «Розничная цена», госномер машины.
func (s *Service) CatalogSave(ctx context.Context, a Actor, kind, id string, b map[string]any) (json.RawMessage, error) {
	if !contains(CatalogEdit[kind], a.Role) {
		return nil, fail(403, "matrix_denied", fmt.Sprintf("Роль «%s» не может менять этот справочник", a.Role))
	}
	str := func(k string) (string, bool) {
		v, ok := b[k]
		if !ok || v == nil {
			return "", ok
		}
		return strings.TrimSpace(fmt.Sprint(v)), true
	}
	ref := uuid.Nil
	if id != "" {
		var err error
		if ref, err = uuid.Parse(id); err != nil {
			return nil, fail(404, "not_found", "Элемент не найден")
		}
	}
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		if kind == "cars" {
			set := map[string]any{}
			if v, ok := str("vin"); ok {
				set["vin"] = v
			}
			if v, ok := str("modelId"); ok {
				set["model_id"] = uuidOrNil(v)
			}
			if v, ok := str("groupId"); ok {
				set["parent_id"] = uuidOrNil(v)
			}
			if v, ok := str("year"); ok {
				if y, err := strconv.Atoi(v); err == nil && y > 0 {
					set["year"] = time.Date(y, 1, 1, 0, 0, 0, 0, time.Local)
				} else {
					set["year"] = nil
				}
			}
			for k, c := range map[string]string{"chassis": "chassis_no", "engine": "engine_no", "comment": "comment", "name": "name"} {
				if v, ok := str(k); ok && (k != "name" || v != "") {
					set[c] = v
				}
			}
			if ref == uuid.Nil {
				if set["vin"] == nil || set["vin"] == "" {
					return fail(400, "bad_request", "VIN не заполнен", "vin")
				}
				var dup bool
				_ = tx.QueryRow(ctx, "select exists(select 1 from ref.car where vin = $1 and not coalesce(is_folder, false) and not deleted)", set["vin"]).Scan(&dup)
				if dup {
					return fail(409, "duplicate", fmt.Sprintf("Машина с VIN %v уже есть", set["vin"]), "vin")
				}
				if set["name"] == nil {
					set["name"] = fmt.Sprintf("VIN %v", set["vin"])
				}
				ref = uuid.Must(uuid.NewV7())
				set["id"], set["deleted"], set["is_folder"] = ref, false, false
				if err := insertRow(ctx, tx, "ref.car", set); err != nil {
					return err
				}
			} else if err := updateRow(ctx, tx, "ref.car", ref, set); err != nil {
				return err
			}
			if v, ok := str("plate"); ok {
				aid := uuid.Must(uuid.NewV7())
				_, err := tx.Exec(ctx, `insert into ref.car_attribute (id, period, car_id, attr_kind, value_type, value_value, onec_key)
					values ($1, localtimestamp, $2, 'ГосНомер', 'string', to_jsonb($3::text), $4)`, aid, ref, v, "app:"+aid.String())
				return err
			}
			return nil
		}
		set := map[string]any{}
		if v, ok := str("name"); ok {
			if v == "" {
				return fail(400, "bad_request", "Наименование не заполнено", "name")
			}
			set["name"] = v
			full, _ := str("fullName")
			if full == "" {
				full = v
			}
			set["full_name"] = full
		}
		if v, ok := str("article"); ok {
			set["article"] = v
		}
		if v, ok := str("unitId"); ok {
			set["unit_id"] = uuidOrNil(v)
		}
		if v, ok := str("comment"); ok {
			set["comment"] = v
		}
		if ref == uuid.Nil {
			if set["name"] == nil {
				return fail(400, "bad_request", "Наименование не заполнено", "name")
			}
			ref = uuid.Must(uuid.NewV7())
			code, err := nextCode(ctx, tx)
			if err != nil {
				return err
			}
			set["id"], set["deleted"], set["is_folder"], set["kind"], set["code"] = ref, false, false, nomKind[kind], code
			if err := insertRow(ctx, tx, "ref.nomenclature", set); err != nil {
				return err
			}
			if err := outbox(ctx, tx, "nomenclature", ref); err != nil {
				return err
			}
		} else if err := updateRow(ctx, tx, "ref.nomenclature", ref, set); err != nil {
			return err
		}
		if v, ok := str("price"); ok && v != "" {
			p, err := strconv.ParseFloat(strings.ReplaceAll(v, ",", "."), 64)
			if err != nil || p < 0 {
				return fail(400, "bad_request", "Цена — неотрицательное число", "price")
			}
			pid := uuid.Must(uuid.NewV7())
			_, err = tx.Exec(ctx, `insert into ref.price (id, period, price_type_id, nomenclature_id, price, actual, author_id, onec_key)
				select $1, localtimestamp, t.id, $2, $3, true, $4, $5 from ref.price_type t where t.name = $6 limit 1`, pid, ref, p, nullable(a.UserID), "app:"+pid.String(), retailPrice)
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.CatalogItem(ctx, kind, ref.String())
}

// CatalogDelete — DELETE /catalog/{kind}/{id} (пометка удаления) и POST …/restore.
func (s *Service) CatalogDelete(ctx context.Context, a Actor, kind, id string, restore bool) (json.RawMessage, error) {
	if !contains(CatalogEdit[kind], a.Role) {
		return nil, fail(403, "matrix_denied", fmt.Sprintf("Роль «%s» не может менять этот справочник", a.Role))
	}
	iid, err := uuid.Parse(id)
	if err != nil {
		return nil, fail(404, "not_found", "Элемент не найден")
	}
	table := "ref.nomenclature"
	if kind == "cars" {
		table = "ref.car"
	}
	if err := s.inTx(ctx, a, func(tx pgx.Tx) error { return updateRow(ctx, tx, table, iid, map[string]any{"deleted": !restore}) }); err != nil {
		return nil, err
	}
	return s.CatalogItem(ctx, kind, id)
}

func uuidOrNil(s string) any {
	u, err := uuid.Parse(s)
	if err != nil {
		return nil
	}
	return u
}

func nextCode(ctx context.Context, tx pgx.Tx) (string, error) {
	if _, err := tx.Exec(ctx, "select pg_advisory_xact_lock(hashtext('ref.nomenclature.code'))"); err != nil {
		return "", err
	}
	var last *string
	_ = tx.QueryRow(ctx, `select code from ref.nomenclature where code ~ '[0-9]+$' order by (substring(code from '[0-9]+$'))::bigint desc limit 1`).Scan(&last)
	prefix, n, width := "НФ-", int64(0), 8
	if last != nil {
		i := strings.LastIndexFunc(*last, func(r rune) bool { return r < '0' || r > '9' })
		prefix, width = (*last)[:i+1], len(*last)-i-1
		fmt.Sscan((*last)[i+1:], &n)
	}
	return fmt.Sprintf("%s%0*d", prefix, width, n+1), nil
}

func insertRow(ctx context.Context, tx pgx.Tx, table string, set map[string]any) error {
	var names, ph []string
	var args []any
	for c, v := range set {
		args = append(args, v)
		names = append(names, pgx.Identifier{c}.Sanitize())
		ph = append(ph, fmt.Sprintf("$%d", len(args)))
	}
	p := strings.SplitN(table, ".", 2)
	_, err := tx.Exec(ctx, fmt.Sprintf("insert into %s (%s) values (%s)", pgx.Identifier{p[0], p[1]}.Sanitize(), strings.Join(names, ", "), strings.Join(ph, ", ")), args...)
	return err
}

func updateRow(ctx context.Context, tx pgx.Tx, table string, id uuid.UUID, set map[string]any) error {
	if len(set) == 0 {
		return nil
	}
	var parts []string
	args := []any{id}
	for c, v := range set {
		args = append(args, v)
		parts = append(parts, fmt.Sprintf("%s = $%d", pgx.Identifier{c}.Sanitize(), len(args)))
	}
	p := strings.SplitN(table, ".", 2)
	tag, err := tx.Exec(ctx, fmt.Sprintf("update %s set %s, version = version + 1, updated_at = now() where id = $1", pgx.Identifier{p[0], p[1]}.Sanitize(), strings.Join(parts, ", ")), args...)
	if err == nil && tag.RowsAffected() == 0 {
		return fail(404, "not_found", "Элемент не найден")
	}
	return err
}
