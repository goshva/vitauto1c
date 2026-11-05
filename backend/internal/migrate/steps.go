package migrate

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"vitauto/backend/internal/onec"
)

// dataTables — непустые таблицы данных объектов с правилом typed / legacy / enum (inventory.json).
func dataTables(meta *onec.Meta) []string {
	seen := map[string]bool{}
	var out []string
	for _, o := range meta.Inventory.Objects {
		if o.Rows == 0 || (o.Rule != "typed" && o.Rule != "legacy" && o.Rule != "enum") {
			continue
		}
		for _, t := range o.Tables {
			if t.Rows > 0 && !seen[t.Storage] {
				seen[t.Storage] = true
				out = append(out, t.Storage)
			}
		}
	}
	sort.Strings(out)
	return out
}

// Extract копирует строки всех непустых таблиц данных 1С в onec.raw (to_jsonb), заполняет onec.type_map и sys.enum_value.
func (m *Migrator) Extract(ctx context.Context) (err error) {
	meta, err := m.Meta()
	if err != nil {
		return err
	}
	src, err := m.source(ctx)
	if err != nil {
		return err
	}
	defer src.Close(ctx)
	db, err := m.target(ctx)
	if err != nil {
		return err
	}
	defer db.Close()
	_, finish := m.run(ctx, db, "extract")
	stats := map[string]any{}
	defer func() { finish(err, stats) }()

	if _, err = db.Exec(ctx, "truncate onec.raw, onec.type_map"); err != nil {
		return err
	}
	var total int64
	tables := dataTables(meta)
	for _, st := range tables {
		rows, err := src.Query(ctx, fmt.Sprintf("select to_jsonb(t)::text from public.%s t", pgx.Identifier{st}.Sanitize()))
		if err != nil {
			return fmt.Errorf("%s: %w", st, err)
		}
		var batch [][]any
		for rows.Next() {
			var j string
			if err := rows.Scan(&j); err != nil {
				rows.Close()
				return err
			}
			batch = append(batch, []any{st, j})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("%s: %w", st, err)
		}
		n, err := db.CopyFrom(ctx, pgx.Identifier{"onec", "raw"}, []string{"storage", "row"}, pgx.CopyFromRows(batch))
		if err != nil {
			return fmt.Errorf("%s: %w", st, err)
		}
		total += n
	}
	stats["tables"], stats["rows"] = len(tables), total
	m.Log("extract: таблиц %d, строк %d", len(tables), total)

	// типы ссылок: номер таблицы -> объект и целевая таблица
	targets := map[string]string{}
	for _, t := range meta.Map.Tables {
		if t.Rule == "typed" && t.Purpose == "Основная" {
			targets[onec.ObjectOf(t.Table)] = t.Target
		}
	}
	var tm [][]any
	for n, t := range meta.TypeNo {
		obj := onec.ObjectOf(t.Meta)
		var target any
		if v, ok := targets[obj]; ok {
			target = v
		}
		tm = append(tm, []any{n, strings.ToLower(t.Storage), obj, target})
	}
	if _, err = db.CopyFrom(ctx, pgx.Identifier{"onec", "type_map"}, []string{"type_no", "storage", "object", "target"}, pgx.CopyFromRows(tm)); err != nil {
		return err
	}

	// перечисления: _IDRRef + _EnumOrder -> имя значения по порядку метаданных
	if _, err = db.Exec(ctx, "truncate sys.enum_value cascade"); err != nil {
		return err
	}
	var ev [][]any
	for st, t := range meta.Tables {
		if !strings.HasPrefix(st, "_enum") {
			continue
		}
		values := meta.Enums[onec.ObjectOf(t.Meta)]
		rows, err := db.Query(ctx, "select row->>'_idrref', (row->>'_enumorder')::int from onec.raw where storage = $1", st)
		if err != nil {
			return err
		}
		for rows.Next() {
			var h string
			var ord int
			if err := rows.Scan(&h, &ord); err != nil {
				rows.Close()
				return err
			}
			id, ok, err := onec.UUIDFromHex(h)
			if err != nil || !ok {
				continue
			}
			name := fmt.Sprintf("#%d", ord)
			if ord < len(values) {
				name = values[ord]
			}
			ev = append(ev, []any{id, onec.ObjectOf(t.Meta), name, ord})
		}
		rows.Close()
	}
	if _, err = db.CopyFrom(ctx, pgx.Identifier{"sys", "enum_value"}, []string{"id", "enum", "name", "ord"}, pgx.CopyFromRows(ev)); err != nil {
		return err
	}
	stats["types"], stats["enumValues"] = len(tm), len(ev)
	m.Log("extract: типов ссылок %d, значений перечислений %d", len(tm), len(ev))
	return nil
}

func enumIndex(ctx context.Context, db *pgxpool.Pool) (onec.EnumIndex, error) {
	rows, err := db.Query(ctx, "select id, enum || '.' || name from sys.enum_value")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	idx := onec.EnumIndex{}
	for rows.Next() {
		var id uuid.UUID
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		idx[id] = name
	}
	return idx, rows.Err()
}

// legacyObject — запись архива.
type legacyObject struct {
	Kind, Name, Key string
	Data            map[string]any
}

// rowSource — строки таблицы хранения (из onec.raw приёмника или прямо из источника — для сверки R3).
type rowSource func(ctx context.Context, storage string) ([]map[string]any, error)

func rawFromTarget(db *pgxpool.Pool) rowSource {
	return func(ctx context.Context, storage string) ([]map[string]any, error) {
		return scanJSON(ctx, func() (pgx.Rows, error) {
			return db.Query(ctx, "select row::text from onec.raw where storage = $1", storage)
		})
	}
}

func rawFromSource(src *pgx.Conn) rowSource {
	return func(ctx context.Context, storage string) ([]map[string]any, error) {
		return scanJSON(ctx, func() (pgx.Rows, error) {
			return src.Query(ctx, fmt.Sprintf("select to_jsonb(t)::text from public.%s t", pgx.Identifier{storage}.Sanitize()))
		})
	}
}

func scanJSON(ctx context.Context, q func() (pgx.Rows, error)) ([]map[string]any, error) {
	rows, err := q()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		r, err := onec.ParseRow([]byte(s))
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// buildLegacy собирает записи архива одного объекта: ссылочные объекты — по Ссылка с табличными частями,
// регистры — по регистратору и номеру строки или по хешу записи, константы — по имени.
func buildLegacy(ctx context.Context, dec *onec.Decoder, o onec.InvObject, read rowSource) ([]legacyObject, int, error) {
	kind := strings.SplitN(o.Object, ".", 2)[0]
	byKey := map[string]*legacyObject{}
	var order []string
	dups := 0
	add := func(key string, data map[string]any) {
		if _, ok := byKey[key]; ok {
			dups++
			key = fmt.Sprintf("%s#%d", key, dups)
		}
		byKey[key] = &legacyObject{Kind: kind, Name: o.Object, Key: key, Data: data}
		order = append(order, key)
	}
	var tps []onec.InvTable
	for _, t := range o.Tables {
		if t.Rows == 0 {
			continue
		}
		if t.Purpose == "ТабличнаяЧасть" {
			tps = append(tps, t)
			continue
		}
		rows, err := read(ctx, t.Storage)
		if err != nil {
			return nil, 0, err
		}
		for _, raw := range rows {
			data := dec.Row(t.Storage, raw)
			var key string
			switch {
			case data["Ссылка"] != nil:
				key = fmt.Sprint(data["Ссылка"])
			case kind == "Константа":
				key = o.Object
			case data["Регистратор"] != nil && data["НомерСтроки"] != nil:
				key = fmt.Sprintf("%v:%v", refID(data["Регистратор"]), data["НомерСтроки"])
			default:
				_, key = onec.Canonical(data)
			}
			add(key, data)
		}
	}
	for _, t := range tps {
		rows, err := read(ctx, t.Storage)
		if err != nil {
			return nil, 0, err
		}
		p := strings.Split(t.Table, ".")
		tpName := p[len(p)-1]
		for _, raw := range rows {
			data := dec.Row(t.Storage, raw)
			owner := fmt.Sprint(data["Ссылка"])
			obj := byKey[owner]
			if obj == nil { // строка табличной части без владельца — отдельной записью, чтобы не потерять
				add(fmt.Sprintf("tp:%s:%s:%v", tpName, owner, data["НомерСтроки"]), data)
				continue
			}
			delete(data, "Ссылка")
			tp, _ := obj.Data["ТабличныеЧасти"].(map[string]any)
			if tp == nil {
				tp = map[string]any{}
				obj.Data["ТабличныеЧасти"] = tp
			}
			list, _ := tp[tpName].([]any)
			tp[tpName] = append(list, data)
		}
	}
	out := make([]legacyObject, 0, len(order))
	for _, k := range order {
		obj := byKey[k]
		if tp, ok := obj.Data["ТабличныеЧасти"].(map[string]any); ok {
			for _, v := range tp {
				list := v.([]any)
				sort.SliceStable(list, func(i, j int) bool { return lineNo(list[i]) < lineNo(list[j]) })
			}
		}
		out = append(out, *obj)
	}
	return out, dups, nil
}

func refID(v any) any {
	if m, ok := v.(map[string]any); ok {
		return m["id"]
	}
	return v
}

func lineNo(v any) float64 {
	m, _ := v.(map[string]any)
	if n, ok := m["НомерСтроки"].(json.Number); ok {
		f, _ := n.Float64()
		return f
	}
	return 0
}

func legacyObjects(meta *onec.Meta) []onec.InvObject {
	var out []onec.InvObject
	for _, o := range meta.Inventory.Objects {
		if o.Rows > 0 && (o.Rule == "typed" || o.Rule == "legacy") {
			out = append(out, o)
		}
	}
	return out
}

// Legacy строит legacy.object из onec.raw.
func (m *Migrator) Legacy(ctx context.Context) (err error) {
	meta, err := m.Meta()
	if err != nil {
		return err
	}
	db, err := m.target(ctx)
	if err != nil {
		return err
	}
	defer db.Close()
	runID, finish := m.run(ctx, db, "legacy")
	stats := map[string]any{}
	defer func() { finish(err, stats) }()
	enums, err := enumIndex(ctx, db)
	if err != nil {
		return err
	}
	dec := &onec.Decoder{Meta: meta, Enums: enums}
	if _, err = db.Exec(ctx, "truncate legacy.object"); err != nil {
		return err
	}
	var total, dups int
	for _, o := range legacyObjects(meta) {
		objs, d, err := buildLegacy(ctx, dec, o, rawFromTarget(db))
		if err != nil {
			return fmt.Errorf("%s: %w", o.Object, err)
		}
		dups += d
		rows := make([][]any, 0, len(objs))
		for _, x := range objs {
			b, h := onec.Canonical(x.Data)
			rows = append(rows, []any{x.Kind, x.Name, x.Key, string(b), h, runID})
		}
		if _, err := db.CopyFrom(ctx, pgx.Identifier{"legacy", "object"}, []string{"kind", "name", "key", "data", "hash", "run_id"}, pgx.CopyFromRows(rows)); err != nil {
			return fmt.Errorf("%s: %w", o.Object, err)
		}
		total += len(rows)
	}
	stats["objects"], stats["duplicates"] = total, dups
	m.Log("legacy: записей %d, совпадающих ключей %d", total, dups)
	return nil
}

// Load выполняет сгенерированный db/load/typed.sql одной транзакцией (внешние ключи проверяются при фиксации).
func (m *Migrator) Load(ctx context.Context) (err error) {
	db, err := m.target(ctx)
	if err != nil {
		return err
	}
	defer db.Close()
	_, finish := m.run(ctx, db, "load")
	stats := map[string]any{}
	defer func() { finish(err, stats) }()
	sqlText, err := os.ReadFile(filepath.Join(m.Root, "db", "load", "typed.sql"))
	if err != nil {
		return err
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "set constraints all deferred"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, string(sqlText)); err != nil {
		return fmt.Errorf("загрузка: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("фиксация (внешние ключи): %w", err)
	}
	counts, err := typedCounts(ctx, db)
	if err != nil {
		return err
	}
	var total int64
	for _, n := range counts {
		total += n
	}
	stats["tables"], stats["rows"] = len(counts), total
	m.Log("load: таблиц %d, строк %d", len(counts), total)
	return nil
}

// typedTables — типизированные таблицы из карты (без повторов).
func typedTables(meta *onec.Meta) []string {
	seen := map[string]bool{}
	var out []string
	for _, t := range meta.Map.Tables {
		if t.Rule == "typed" && !seen[t.Target] {
			seen[t.Target] = true
			out = append(out, t.Target)
		}
	}
	sort.Strings(out)
	return out
}

func typedCounts(ctx context.Context, db *pgxpool.Pool) (map[string]int64, error) {
	rows, err := db.Query(ctx, `select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
		where c.relkind = 'r' and n.nspname in ('ref','doc','stock','arm','auth') order by 1`)
	if err != nil {
		return nil, err
	}
	var names []string
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		names = append(names, s)
	}
	rows.Close()
	out := map[string]int64{}
	for _, n := range names {
		var c int64
		p := strings.SplitN(n, ".", 2)
		if err := db.QueryRow(ctx, "select count(*) from "+pgx.Identifier{p[0], p[1]}.Sanitize()).Scan(&c); err != nil {
			return nil, err
		}
		out[n] = c
	}
	return out, nil
}

// Derive — производные данные: склады, ячейки, статусы строк (план, раздел 8, derive).
func (m *Migrator) Derive(ctx context.Context) (err error) {
	db, err := m.target(ctx)
	if err != nil {
		return err
	}
	defer db.Close()
	_, finish := m.run(ctx, db, "derive")
	stats := map[string]any{}
	defer func() { finish(err, stats) }()

	var model struct {
		Statuses []struct {
			ID, Title string
			OnecEnums []string `json:"onecEnums"`
		} `json:"statuses"`
	}
	b, err := os.ReadFile(filepath.Join(m.Root, "docs", "migration", "ddd", "domain-model.json"))
	if err != nil {
		return err
	}
	if err = json.Unmarshal(b, &model); err != nil {
		return err
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	steps := []string{
		`update ref.warehouse set is_warehouse = (unit_type = 'Склад'), is_main = false`,
		// основной склад — тот, по которому есть движения запасов (в vitauto_dev — «Основной склад»)
		`update ref.warehouse w set is_main = true where w.id = (
		   select coalesce((select warehouse_id from stock.move where warehouse_type = 'ref.warehouse' group by 1 order by count(*) desc limit 1),
		                   (select id from ref.warehouse where name = 'Основной склад' limit 1)))`,
		`update arm.line set cell_id = null, warehouse_id = (select id from ref.warehouse where is_main)`,
		`delete from ref.storage_cell`,
		// id ячейки детерминирован (склад:код): повторный перенос даёт те же id (проверка IDEMPOTENT)
		`insert into ref.storage_cell (id, warehouse_id, code)
		 select uuid_generate_v5('` + onec.NSRegister.String() + `', 'cell:' || w.id || ':' || c.code), w.id, c.code
		 from (select distinct btrim(cell_legacy) as code from arm.line where btrim(coalesce(cell_legacy, '')) <> '') c, ref.warehouse w where w.is_main`,
		`update arm.line l set cell_id = c.id from ref.storage_cell c where c.code = btrim(l.cell_legacy)`,
		`delete from arm.line_status`,
	}
	for _, s := range steps {
		if _, err = tx.Exec(ctx, s); err != nil {
			return fmt.Errorf("%s: %w", strings.Fields(s)[0:3], err)
		}
	}
	for i, s := range model.Statuses {
		for _, e := range s.OnecEnums {
			if _, err = tx.Exec(ctx, "insert into arm.line_status (name, api_status, title, ord) values ($1, $2, $3, $4)", e, s.ID, s.Title, i); err != nil {
				return err
			}
		}
	}
	// значения перечисления, которых нет в матрице (ЗаблокированоФоном и др.), — со своим кодом
	if _, err = tx.Exec(ctx, `insert into arm.line_status (name, api_status, title, ord)
		select v.name, case v.name when 'ЗаблокированоФоном' then 'locked_background' else 'onec_' || v.ord end, v.name, 100 + v.ord
		from sys.enum_value v where v.enum = 'Перечисление.Арм_СтатусыАРМ' and v.name not in (select name from arm.line_status)`); err != nil {
		return err
	}
	var cells, lines, statuses int
	_ = tx.QueryRow(ctx, "select (select count(*) from ref.storage_cell), (select count(*) from arm.line where warehouse_id is not null), (select count(*) from arm.line_status)").Scan(&cells, &lines, &statuses)
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	stats["cells"], stats["linesWithWarehouse"], stats["statuses"] = cells, lines, statuses
	m.Log("derive: ячеек %d, строк АРМ со складом %d, статусов %d", cells, lines, statuses)
	return nil
}
