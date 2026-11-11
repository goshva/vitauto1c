package arm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Раздел «Справочники» (страница Directories): чтение доступно всем авторизованным,
// создание, изменение и пометка удаления — только администратору (НСИ ведёт админ, как у брендов).
var directoryEditRoles = []string{"admin"}

// dirField — редактируемое поле справочника: JSON-имя -> колонка и тип значения запроса.
type dirField struct {
	col  string
	kind string // text | bool | int | numeric | uuid | date
}

// dirDef — описание справочника для CRUD.
type dirDef struct {
	table    string         // ref.<table>
	from     string         // источник выборки; пусто — ref.<table>
	idCol    string         // колонка идентификатора; пусто — id
	item     string         // SQL-выражение jsonb одного элемента
	fields   map[string]dirField
	required []string       // обязательные поля (проверяются при создании)
	create   map[string]any // значения по умолчанию при создании
	list     func(q map[string]string) (string, []any)
	guard    func(ctx context.Context, tx pgx.Tx, id uuid.UUID) error
}

// dirDefs — справочники, которые администратор ведёт из раздела «Справочники».
// Состав полей намеренно узкий: служебные столбцы 1С (extra, onec_version, predefined) не трогаем.
var dirDefs = map[string]dirDef{
	"counterparties": {
		table: "ref.counterparty",
		item: `jsonb_build_object('id', id, 'name', name, 'fullName', coalesce(full_name, ''),
			'inn', coalesce(inn, ''), 'kpp', coalesce(kpp, ''), 'comment', coalesce(comment, ''),
			'isCustomer', coalesce(is_customer, false), 'isSupplier', coalesce(is_supplier, false),
			'inactive', coalesce(inactive, false), 'deleted', deleted)`,
		fields: map[string]dirField{
			"name":       {"name", "text"},
			"fullName":   {"full_name", "text"},
			"inn":        {"inn", "text"},
			"kpp":        {"kpp", "text"},
			"comment":    {"comment", "text"},
			"isCustomer": {"is_customer", "bool"},
			"isSupplier": {"is_supplier", "bool"},
			"inactive":   {"inactive", "bool"},
		},
		required: []string{"name"},
		create:   map[string]any{"is_folder": false},
		list: func(q map[string]string) (string, []any) {
			return `where (not coalesce(is_folder, false)) and ($1 or not deleted)
				and ($2 = '' or lower(name) like $3) order by name limit 100`,
				[]any{q["deleted"] == "true", strings.TrimSpace(q["q"]), like(q["q"])}
		},
	},
	"contracts": {
		table: "ref.contract",
		item: `jsonb_build_object('id', id, 'name', name, 'contractNo', coalesce(contract_no, ''),
			'contractDate', coalesce(to_char(contract_date, 'YYYY-MM-DD'), ''), 'comment', coalesce(comment, ''),
			'counterpartyId', counterparty_id, 'inactive', coalesce(inactive, false), 'deleted', deleted)`,
		fields: map[string]dirField{
			"name":           {"name", "text"},
			"contractNo":     {"contract_no", "text"},
			"contractDate":   {"contract_date", "date"},
			"comment":        {"comment", "text"},
			"counterpartyId": {"counterparty_id", "uuid"},
			"inactive":       {"inactive", "bool"},
		},
		required: []string{"name", "counterpartyId"},
		list: func(q map[string]string) (string, []any) {
			return `where ($1 or not deleted) and counterparty_id = $2::uuid order by name limit 200`,
				[]any{q["deleted"] == "true", q["ownerId"]}
		},
	},
	"service-types": {
		table: "ref.service_kind",
		item: `jsonb_build_object('id', id, 'name', name, 'code', coalesce(code, ''), 'deleted', deleted)`,
		fields: map[string]dirField{
			"name": {"name", "text"},
			"code": {"code", "text"},
		},
		required: []string{"name"},
		list: func(q map[string]string) (string, []any) {
			return `where ($1 or not deleted) and ($2 = '' or lower(name) like $3) order by name limit 200`,
				[]any{q["deleted"] == "true", strings.TrimSpace(q["q"]), like(q["q"])}
		},
	},
	"payment-forms": {
		table: "ref.payment_form",
		item: `jsonb_build_object('id', id, 'name', name, 'code', coalesce(code, ''), 'deleted', deleted)`,
		fields: map[string]dirField{
			"name": {"name", "text"},
			"code": {"code", "text"},
		},
		required: []string{"name"},
		list: func(q map[string]string) (string, []any) {
			return `where ($1 or not deleted) and ($2 = '' or lower(name) like $3) order by name limit 200`,
				[]any{q["deleted"] == "true", strings.TrimSpace(q["q"]), like(q["q"])}
		},
	},
	"units": {
		table: "ref.unit",
		item: `jsonb_build_object('id', id, 'name', name, 'code', coalesce(code, ''),
			'fullName', coalesce(full_name, ''), 'intlCode', coalesce(intl_code, ''), 'deleted', deleted)`,
		fields: map[string]dirField{
			"name":     {"name", "text"},
			"code":     {"code", "text"},
			"fullName": {"full_name", "text"},
			"intlCode": {"intl_code", "text"},
		},
		required: []string{"name"},
		list: func(q map[string]string) (string, []any) {
			return `where ($1 or not deleted) and ($2 = '' or lower(name) like $3) order by name limit 200`,
				[]any{q["deleted"] == "true", strings.TrimSpace(q["q"]), like(q["q"])}
		},
	},
	"warehouses": {
		table: "ref.warehouse",
		item: `jsonb_build_object('id', id, 'name', name, 'code', coalesce(code, ''),
			'unitType', coalesce(unit_type, ''), 'isWarehouse', coalesce(is_warehouse, false),
			'isMain', coalesce(is_main, false), 'main', coalesce(is_main, false),
			'orderBased', coalesce(order_based, false), 'deleted', deleted)`,
		fields: map[string]dirField{
			"name":        {"name", "text"},
			"code":        {"code", "text"},
			"unitType":    {"unit_type", "text"},
			"isWarehouse": {"is_warehouse", "bool"},
			"isMain":      {"is_main", "bool"},
			"orderBased":  {"order_based", "bool"},
		},
		required: []string{"name"},
		create:   map[string]any{"is_warehouse": true},
		list: func(q map[string]string) (string, []any) {
			return `where ($1 or not deleted) and (is_warehouse or $1)
				and ($2 = '' or lower(name) like $3) order by is_main desc, name limit 200`,
				[]any{q["deleted"] == "true", strings.TrimSpace(q["q"]), like(q["q"])}
		},
		guard: func(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
			var main bool
			if err := tx.QueryRow(ctx, `select coalesce(is_main, false) from ref.warehouse where id = $1`, id).Scan(&main); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return fail(404, "not_found", "Склад не найден")
				}
				return err
			}
			if main {
				return fail(409, "warehouse_main", "Основной склад нельзя пометить на удаление: сначала назначьте другой")
			}
			return nil
		},
	},
	"zones": {
		table: "ref.warehouse_zone",
		item: `jsonb_build_object('id', id, 'code', code, 'name', name, 'purpose', coalesce(purpose, ''),
			'sort', sort, 'cells', (select count(*) from ref.storage_cell c where c.zone_id = ref.warehouse_zone.id and not c.deleted),
			'deleted', deleted)`,
		fields: map[string]dirField{
			"code":    {"code", "text"},
			"name":    {"name", "text"},
			"purpose": {"purpose", "text"},
			"sort":    {"sort", "int"},
		},
		required: []string{"code", "name"},
		list: func(q map[string]string) (string, []any) {
			return `where ($1 or not deleted) order by sort, code`, []any{q["deleted"] == "true"}
		},
		guard: func(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
			var used int
			if err := tx.QueryRow(ctx, `select count(*) from ref.storage_cell where zone_id = $1 and not deleted`, id).Scan(&used); err != nil {
				return err
			}
			if used > 0 {
				return fail(409, "zone_in_use", fmt.Sprintf("В зоне есть ячейки: %d. Сначала перенесите или удалите их.", used))
			}
			return nil
		},
	},
	"cells": {
		table: "ref.storage_cell",
		from:  "ref.storage_cell c left join ref.warehouse_zone z on z.id = c.zone_id",
		idCol: "c.id",
		item: `jsonb_build_object('id', c.id, 'name', c.code, 'code', c.code, 'warehouseId', c.warehouse_id,
			'zone', coalesce(c.zone, ''), 'zoneId', c.zone_id, 'zoneName', coalesce(z.name, ''),
			'capacity', c.capacity, 'blocked', c.blocked, 'deleted', c.deleted)`,
		fields: map[string]dirField{
			"code":        {"code", "text"},
			"warehouseId": {"warehouse_id", "uuid"},
			"zoneId":      {"zone_id", "uuid"},
			"capacity":    {"capacity", "numeric"},
			"blocked":     {"blocked", "bool"},
		},
		required: []string{"code", "warehouseId"},
		list: func(q map[string]string) (string, []any) {
			return `where ($1 or not c.deleted) and ($2 = '' or c.warehouse_id = $2::uuid)
				order by coalesce(z.sort, 99), c.code limit 500`,
				[]any{q["deleted"] == "true", q["warehouseId"]}
		},
	},
}

// dirNames — имена справочников с CRUD (для текстов ошибок), по алфавиту.
func dirNames() []string {
	out := make([]string, 0, len(dirDefs))
	for n := range dirDefs {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func dirDefOf(name string) (dirDef, error) {
	d, ok := dirDefs[name]
	if !ok {
		return dirDef{}, fail(404, "not_found", "Справочник для правки: "+strings.Join(dirNames(), ", "))
	}
	return d, nil
}

func (d dirDef) source() string {
	if d.from != "" {
		return d.from
	}
	return d.table
}

func (d dirDef) keyCol() string {
	if d.idCol != "" {
		return d.idCol
	}
	return "id"
}

// DirectoryList — список справочника с полями для правки (GET /directories/{name}).
func (s *Service) DirectoryList(ctx context.Context, name string, q map[string]string) ([]json.RawMessage, error) {
	d, err := dirDefOf(name)
	if err != nil {
		return nil, err
	}
	// Договоры — вложенный справочник: без выбранного контрагента список пуст (как и раньше).
	if name == "contracts" && strings.TrimSpace(q["ownerId"]) == "" {
		return []json.RawMessage{}, nil
	}
	where, args := d.list(q)
	return jsonRows(ctx, s.DB, "select "+d.item+" from "+d.source()+" "+where, args...)
}

// DirectoryItem — один элемент справочника (GET /directories/{name}/{id}).
func (s *Service) DirectoryItem(ctx context.Context, name, id string) (json.RawMessage, error) {
	d, err := dirDefOf(name)
	if err != nil {
		return nil, err
	}
	iid, err := uuid.Parse(id)
	if err != nil {
		return nil, fail(404, "not_found", "Элемент не найден")
	}
	var b []byte
	err = s.DB.QueryRow(ctx, "select "+d.item+" from "+d.source()+" where "+d.keyCol()+" = $1", iid).Scan(&b)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail(404, "not_found", "Элемент не найден")
	}
	return b, err
}

// DirectorySave — POST /directories/{name} и PATCH /directories/{name}/{id}: элемент справочника.
// Меняет только администратор; поля вне d.fields игнорируются.
func (s *Service) DirectorySave(ctx context.Context, a Actor, name, id string, b map[string]any) (json.RawMessage, error) {
	d, err := dirDefOf(name)
	if err != nil {
		return nil, err
	}
	if !contains(directoryEditRoles, a.Role) {
		return nil, fail(403, "matrix_denied", fmt.Sprintf("Справочник «%s» меняет только администратор", name))
	}
	ref := uuid.Nil
	if id != "" {
		if ref, err = uuid.Parse(id); err != nil {
			return nil, fail(404, "not_found", "Элемент не найден")
		}
	}
	set := map[string]any{}
	for key, f := range d.fields {
		raw, ok := b[key]
		if !ok {
			continue
		}
		v, err := dirValue(f.kind, raw, key)
		if err != nil {
			return nil, err
		}
		set[f.col] = v
	}
	for _, req := range d.required {
		if v, ok := set[d.fields[req].col]; ok && v == nil {
			return nil, fail(400, "bad_request", "Поле «"+req+"» не заполнено", req)
		}
	}
	if ref == uuid.Nil {
		for _, req := range d.required {
			if _, ok := set[d.fields[req].col]; !ok {
				return nil, fail(400, "bad_request", "Поле «"+req+"» не заполнено", req)
			}
		}
	}
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		// Основной склад ровно один: назначая новый, снимаем признак с прежнего.
		if name == "warehouses" {
			if main, ok := set["is_main"].(bool); ok && main {
				if _, err := tx.Exec(ctx, "update ref.warehouse set is_main = false, updated_at = now() where is_main and id <> $1", ref); err != nil {
					return err
				}
			}
		}
		// Ячейка: код зоны (ref.storage_cell.zone) держим согласованным с zone_id и при создании, и при изменении.
		if name == "cells" {
			if err := syncCellZone(ctx, tx, set); err != nil {
				return err
			}
		}
		if ref == uuid.Nil {
			for c, v := range d.create {
				if _, ok := set[c]; !ok {
					set[c] = v
				}
			}
			ref = uuid.Must(uuid.NewV7())
			set["id"], set["deleted"] = ref, false
			if err := insertRow(ctx, tx, d.table, set); err != nil {
				return dirDBError(err, name)
			}
			return nil
		}
		if err := updateRow(ctx, tx, d.table, ref, set); err != nil {
			return dirDBError(err, name)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.DirectoryItem(ctx, name, ref.String())
}

// syncCellZone — код зоны в ref.storage_cell.zone держим согласованным с zone_id
// (поле оставлено для совместимости с переносом из 1С и старыми запросами).
func syncCellZone(ctx context.Context, tx pgx.Tx, set map[string]any) error {
	raw, ok := set["zone_id"]
	if !ok {
		return nil
	}
	if raw == nil {
		set["zone"] = nil
		return nil
	}
	var code string
	err := tx.QueryRow(ctx, "select code from ref.warehouse_zone where id = $1", raw).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(400, "bad_request", "Зона склада не найдена", "zoneId")
	}
	if err != nil {
		return err
	}
	set["zone"] = code
	return nil
}

// DirectoryDelete — DELETE /directories/{name}/{id} (пометка удаления) и POST …/restore.
func (s *Service) DirectoryDelete(ctx context.Context, a Actor, name, id string, restore bool) (json.RawMessage, error) {
	d, err := dirDefOf(name)
	if err != nil {
		return nil, err
	}
	if !contains(directoryEditRoles, a.Role) {
		return nil, fail(403, "matrix_denied", fmt.Sprintf("Справочник «%s» меняет только администратор", name))
	}
	iid, err := uuid.Parse(id)
	if err != nil {
		return nil, fail(404, "not_found", "Элемент не найден")
	}
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		if !restore && d.guard != nil {
			if err := d.guard(ctx, tx, iid); err != nil {
				return err
			}
		}
		return updateRow(ctx, tx, d.table, iid, map[string]any{"deleted": !restore})
	})
	if err != nil {
		return nil, err
	}
	return s.DirectoryItem(ctx, name, id)
}

// dirValue — значение запроса по типу поля справочника; пустая строка — NULL.
func dirValue(kind string, raw any, field string) (any, error) {
	switch kind {
	case "bool":
		switch v := raw.(type) {
		case bool:
			return v, nil
		case float64:
			return v != 0, nil
		}
		switch strings.ToLower(strings.TrimSpace(fmt.Sprint(raw))) {
		case "":
			return nil, nil
		case "true", "1", "да", "yes":
			return true, nil
		case "false", "0", "нет", "no":
			return false, nil
		}
		return nil, fail(400, "bad_request", "Поле «"+field+"»: ожидается да/нет", field)
	case "int":
		s := strings.TrimSpace(fmt.Sprint(raw))
		if s == "" {
			return nil, nil
		}
		n, err := strconv.Atoi(s)
		if err != nil {
			return nil, fail(400, "bad_request", "Поле «"+field+"»: ожидается целое число", field)
		}
		return n, nil
	case "numeric":
		s := strings.ReplaceAll(strings.TrimSpace(fmt.Sprint(raw)), ",", ".")
		if s == "" {
			return nil, nil
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil, fail(400, "bad_request", "Поле «"+field+"»: ожидается число", field)
		}
		return f, nil
	case "uuid":
		s := strings.TrimSpace(fmt.Sprint(raw))
		if s == "" {
			return nil, nil
		}
		u, err := uuid.Parse(s)
		if err != nil {
			return nil, fail(400, "bad_request", "Поле «"+field+"»: ожидается идентификатор", field)
		}
		return u, nil
	case "date":
		s := strings.TrimSpace(fmt.Sprint(raw))
		if s == "" {
			return nil, nil
		}
		t, err := time.Parse("2006-01-02", s)
		if err != nil {
			return nil, fail(400, "bad_request", "Поле «"+field+"»: ожидается дата ГГГГ-ММ-ДД", field)
		}
		return t, nil
	}
	s := strings.TrimSpace(fmt.Sprint(raw))
	if s == "" {
		return nil, nil
	}
	return s, nil
}

// dirDBError — ошибки ограничений БД в понятные ответы API.
func dirDBError(err error, name string) error {
	var pg *pgconn.PgError
	if !errors.As(err, &pg) {
		return err
	}
	switch pg.Code {
	case "23505": // unique_violation
		msg, field := "Такой элемент уже есть", ""
		switch name {
		case "zones":
			msg, field = "Зона с таким кодом уже есть", "code"
		case "cells":
			msg, field = "Ячейка с таким кодом уже есть на этом складе", "code"
		case "warehouses":
			msg, field = "Основной склад уже назначен", "isMain"
		}
		return fail(409, "duplicate", msg, field)
	case "23503": // foreign_key_violation
		return fail(400, "bad_request", "Ссылка на несуществующий элемент справочника")
	case "23502": // not_null_violation
		return fail(400, "bad_request", "Не заполнено обязательное поле")
	}
	return err
}
