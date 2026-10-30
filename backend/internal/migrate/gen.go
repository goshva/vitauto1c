// Package migrate — перенос данных 1С в vitauto_app (план, разделы 7–9): генерация схемы и загрузки, extract, legacy,
// load, derive, reconcile.
package migrate

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"vitauto/backend/internal/onec"
)

// ColInfo — тип столбца таблицы хранения 1С (information_schema источника).
type ColInfo struct {
	Udt              string
	Precision, Scale *int
}

// SourceColumns читает типы столбцов указанных таблиц хранения 1С.
func SourceColumns(ctx context.Context, src *pgx.Conn, storages []string) (map[string]map[string]ColInfo, error) {
	rows, err := src.Query(ctx, `select table_name, column_name, udt_name, numeric_precision, numeric_scale
		from information_schema.columns where table_schema = 'public' and table_name = any($1)`, storages)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]map[string]ColInfo{}
	for rows.Next() {
		var t, c, u string
		var p, s *int
		if err := rows.Scan(&t, &c, &u, &p, &s); err != nil {
			return nil, err
		}
		if out[t] == nil {
			out[t] = map[string]ColInfo{}
		}
		out[t][c] = ColInfo{Udt: u, Precision: p, Scale: s}
	}
	return out, rows.Err()
}

type tableKind int

const (
	kindRef tableKind = iota // справочник / документ: id = Ссылка
	kindTP                   // табличная часть: id = v5(владелец:номер строки)
	kindReg                  // регистр: id = v5(таблица:ключ записи)
)

type genCol struct {
	Name, Type, Expr, Comment string
	FK                        string // целевая таблица внешнего ключа
}

type genSource struct {
	MT       onec.MapTable
	Object   string
	Kind     tableKind
	Cols     []genCol // столбцы в порядке таблицы назначения (id первым)
	Extra    string   // выражение extra jsonb
	KeyExpr  string   // onec_key (регистры)
	ownerCol string
}

type genTarget struct {
	Name    string
	Order   int
	Kind    tableKind
	Shared  bool
	Sources []*genSource
	Cols    []genCol // объединение столбцов источников
}

var (
	reUUIDText = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`
	reSuffix   = regexp.MustCompile(`_(type|l|n|t|s|rtref|rrref|tref)$`)
)

// Generate строит DDL типизированных таблиц (db/migrations/0002_typed.sql) и SQL загрузки (db/load/typed.sql).
func Generate(meta *onec.Meta, cols map[string]map[string]ColInfo) (ddl, load string, err error) {
	targets := map[string]*genTarget{}
	refTarget := map[string]string{} // объект -> целевая таблица (только справочники и документы)
	for _, t := range meta.Map.Tables {
		if t.Rule == "typed" && t.Purpose == "Основная" && kindOf(t) == kindRef {
			refTarget[onec.ObjectOf(t.Table)] = t.Target
		}
	}
	for i := range meta.Map.Tables {
		t := meta.Map.Tables[i]
		if t.Rule != "typed" {
			continue
		}
		g := targets[t.Target]
		if g == nil {
			g = &genTarget{Name: t.Target, Order: *t.Order, Kind: kindOf(t)}
			targets[t.Target] = g
		}
		src, err := buildSource(meta, t, cols[t.Storage], refTarget)
		if err != nil {
			return "", "", fmt.Errorf("%s: %w", t.Table, err)
		}
		g.Sources = append(g.Sources, src)
	}
	list := make([]*genTarget, 0, len(targets))
	for _, g := range targets {
		g.Shared = len(g.Sources) > 1
		seen := map[string]int{}
		for _, s := range g.Sources {
			for _, c := range s.Cols {
				if i, ok := seen[c.Name]; ok {
					if g.Cols[i].FK != c.FK {
						g.Cols[i].FK = "" // общая таблица: разные владельцы — без внешнего ключа
					}
					continue
				}
				seen[c.Name] = len(g.Cols)
				g.Cols = append(g.Cols, c)
			}
		}
		list = append(list, g)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Order != list[j].Order {
			return list[i].Order < list[j].Order
		}
		return list[i].Name < list[j].Name
	})
	return renderDDL(list), renderLoad(list), nil
}

func kindOf(t onec.MapTable) tableKind {
	switch {
	case t.Purpose == "ТабличнаяЧасть":
		return kindTP
	case strings.HasPrefix(t.Table, "Справочник.") || strings.HasPrefix(t.Table, "Документ."):
		return kindRef
	default:
		return kindReg
	}
}

func buildSource(meta *onec.Meta, t onec.MapTable, ci map[string]ColInfo, refTarget map[string]string) (*genSource, error) {
	obj := onec.ObjectOf(t.Table)
	s := &genSource{MT: t, Object: obj, Kind: kindOf(t)}
	tpName := ""
	if s.Kind == kindTP {
		p := strings.Split(t.Table, ".")
		tpName = p[len(p)-1] + "."
	}
	types := meta.Types[obj]
	var idExpr string
	var extraPairs []string
	used := map[string]bool{"id": true}
	var cols []genCol
	var lineNo, recorder string
	for _, f := range t.Fields {
		st := f.Storage
		decoded := genericExpr(st, ci)
		if f.Column == nil {
			extraPairs = append(extraPairs, fmt.Sprintf("'%s', %s", f.Onec, decoded))
			continue
		}
		col := *f.Column
		src := fmt.Sprintf("1С: %s.%s (%s.%s)", t.Table, f.Onec, t.Storage, strings.Join(st, ", "))
		switch {
		case f.Onec == "Ссылка" && s.Kind == kindRef:
			idExpr = fmt.Sprintf("onec.uuid(j->>'%s')", st[0])
			cols = append(cols, genCol{Name: "id", Type: "uuid primary key", Expr: idExpr, Comment: src + "; UUID = Ref_Key 1С"})
			continue
		case f.Onec == "Ссылка" && s.Kind == kindTP:
			s.ownerCol = st[0]
		case f.Onec == "НомерСтроки":
			lineNo = st[0]
		}
		// составной тип: в карте помечен (_TYPE / _RTRef) или хранится несколькими столбцами (Регистратор: _RecorderTRef + _RecorderRRef)
		if f.Composite || len(st) > 1 {
			base := strings.TrimSuffix(strings.Split(col, " + ")[0], "_type")
			if f.Onec == "Регистратор" {
				recorder = storageWith(st, "rrref")
			}
			for _, c := range compositeCols(base, st, src) {
				if !used[c.Name] {
					used[c.Name] = true
					cols = append(cols, c)
				}
			}
			continue
		}
		name := col
		if name == "id" && s.Kind == kindReg { // ИдентификаторЗаписи / Ид: id вычисляется ниже, исходное значение — onec_record_id
			name = "onec_record_id"
		}
		for used[name] {
			name += "_2"
		}
		used[name] = true
		typ, expr := scalar(st[0], ci[st[0]])
		var fk string
		attr := tpName + f.Onec
		switch f.Onec {
		case "Родитель":
			fk = refTarget[obj]
		case "Ссылка":
			fk = refTarget[obj]
		case "Владелец":
			attr = "Владелец"
		}
		if tl, ok := types[attr]; ok && typ == "uuid" {
			if allEnum(tl) {
				typ, expr = "text", fmt.Sprintf("(select e.name from sys.enum_value e where e.id = onec.uuid(j->>'%s'))", st[0])
				src += "; перечисление " + tl[0]
			} else if len(tl) == 1 && refTarget[tl[0]] != "" {
				fk = refTarget[tl[0]]
			} else if len(tl) == 1 {
				src += "; ссылка " + tl[0] + " (legacy.object)"
			}
		}
		cols = append(cols, genCol{Name: name, Type: typ, Expr: expr, Comment: src, FK: fk})
	}
	switch s.Kind {
	case kindTP:
		if s.ownerCol == "" || lineNo == "" {
			return nil, fmt.Errorf("табличная часть без Ссылка/НомерСтроки")
		}
		idExpr = fmt.Sprintf("uuid_generate_v5('%s', onec.uuid(j->>'%s')::text || ':' || (j->>'%s'))", onec.NSTabular, s.ownerCol, lineNo)
		cols = append([]genCol{{Name: "id", Type: "uuid primary key", Expr: idExpr, Comment: "UUID v5 (владелец:НомерСтроки), план 5.2"}}, cols...)
	case kindReg:
		key := "md5(j::text)"
		if recorder != "" && lineNo != "" {
			key = fmt.Sprintf("onec.uuid(j->>'%s')::text || ':' || (j->>'%s')", recorder, lineNo)
		}
		s.KeyExpr = key
		idExpr = fmt.Sprintf("uuid_generate_v5('%s', '%s:' || %s)", onec.NSRegister, t.Target, key)
		if id := fieldStorage(t, "ИдентификаторЗаписи"); id != "" { // строка АРМ: id = ИдентификаторЗаписи
			idExpr = fmt.Sprintf("case when j->>'%[1]s' ~ %[2]s then (j->>'%[1]s')::uuid else uuid_generate_v5('%[3]s', j->>'%[1]s') end", id, reUUIDText, onec.NSArm)
		} else if id := fieldStorage(t, "Ид"); id != "" { // уведомление АРМ: id = Ид
			idExpr = fmt.Sprintf("case when j->>'%[1]s' ~ %[2]s then (j->>'%[1]s')::uuid else uuid_generate_v5('%[3]s', j->>'%[1]s') end", id, reUUIDText, onec.NSArm)
		}
		out := cols[:0]
		for _, c := range cols {
			if c.Name != "id" {
				out = append(out, c)
			}
		}
		cols = append([]genCol{{Name: "id", Type: "uuid primary key", Expr: idExpr, Comment: "UUID v5 / ИдентификаторЗаписи, план 5.2"}}, out...)
	}
	s.Cols = cols
	s.Extra = jsonbObject(extraPairs)
	return s, nil
}

func fieldStorage(t onec.MapTable, name string) string {
	for _, f := range t.Fields {
		if f.Onec == name && len(f.Storage) == 1 {
			return f.Storage[0]
		}
	}
	return ""
}

func storageWith(st []string, suffix string) string {
	for _, s := range st {
		if strings.HasSuffix(s, suffix) {
			return s
		}
	}
	return ""
}

func allEnum(types []string) bool {
	if len(types) == 0 {
		return false
	}
	for _, t := range types {
		if !strings.HasPrefix(t, "Перечисление.") {
			return false
		}
	}
	return true
}

// scalar — тип и выражение одного столбца хранения 1С.
func scalar(col string, ci ColInfo) (typ, expr string) {
	switch {
	case col == "_version":
		return "text", fmt.Sprintf("j->>'%s'", col)
	case ci.Udt == "bytea" && (strings.HasSuffix(col, "rref") || strings.HasSuffix(col, "idrref") || col == "_predefinedid"):
		return "uuid", fmt.Sprintf("onec.uuid(j->>'%s')", col)
	case ci.Udt == "bytea":
		return "bytea", fmt.Sprintf("decode(substr(j->>'%s', 3), 'hex')", col)
	case ci.Udt == "numeric":
		t := "numeric"
		if ci.Precision != nil && ci.Scale != nil {
			t = fmt.Sprintf("numeric(%d,%d)", *ci.Precision, *ci.Scale)
		}
		return t, fmt.Sprintf("(j->>'%s')::%s", col, t)
	case ci.Udt == "int4":
		return "integer", fmt.Sprintf("(j->>'%s')::integer", col)
	case ci.Udt == "int8":
		return "bigint", fmt.Sprintf("(j->>'%s')::bigint", col)
	case ci.Udt == "bool":
		return "boolean", fmt.Sprintf("(j->>'%s')::boolean", col)
	case ci.Udt == "timestamp":
		return "timestamp", fmt.Sprintf("onec.ts(j->>'%s')", col)
	case ci.Udt == "mchar":
		return "text", fmt.Sprintf("rtrim(j->>'%s')", col)
	default: // mvarchar
		return "text", fmt.Sprintf("j->>'%s'", col)
	}
}

// compositeCols — составной тип 1С: <base>_type (целевая таблица или вид примитива), <base>_id (ссылка), <base>_value (примитив).
func compositeCols(base string, st []string, src string) []genCol {
	get := func(sfx string) string { return storageWith(st, "_"+sfx) }
	tp, rt, rr := get("type"), storageWith(st, "rtref"), storageWith(st, "rrref")
	refType := "null"
	if rt != "" {
		refType = fmt.Sprintf("(select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'%s'))", rt)
	}
	refID := "null::uuid"
	if rr != "" {
		refID = fmt.Sprintf("onec.uuid(j->>'%s')", rr)
	}
	if tp == "" { // только ссылки (Регистратор): _RTRef + _RRRef
		return []genCol{
			{Name: base + "_type", Type: "text", Expr: refType, Comment: src + "; тип ссылки"},
			{Name: base + "_id", Type: "uuid", Expr: refID, Comment: src + "; ссылка"},
		}
	}
	value := "case j->>'" + tp + "'"
	for _, cs := range [][2]string{{`\\x02`, "l"}, {`\\x03`, "n"}, {`\\x04`, "t"}, {`\\x05`, "s"}} { // порядок фиксирован: вывод детерминирован
		code, sfx := cs[0], cs[1]
		if c := get(sfx); c != "" {
			value += fmt.Sprintf(" when E'%s' then j->'%s'", code, c)
		}
	}
	if strings.Contains(value, " when ") {
		value += " end"
	} else { // у составного типа только ссылки — примитивного значения нет
		value = "null::jsonb"
	}
	kind := fmt.Sprintf(`case j->>'%s' when E'\\x08' then %s when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end`, tp, refType)
	id := fmt.Sprintf(`case when j->>'%s' = E'\\x08' then %s end`, tp, refID)
	return []genCol{
		{Name: base + "_type", Type: "text", Expr: kind, Comment: src + "; вид значения / тип ссылки"},
		{Name: base + "_id", Type: "uuid", Expr: id, Comment: src + "; ссылка"},
		{Name: base + "_value", Type: "jsonb", Expr: value, Comment: src + "; примитивное значение"},
	}
}

// genericExpr — значение неназванного поля для extra jsonb: ссылки — UUID, составные — объект, прочее — как в 1С.
func genericExpr(st []string, ci map[string]ColInfo) string {
	if len(st) == 1 {
		c := st[0]
		if ci[c].Udt == "bytea" && (strings.HasSuffix(c, "rref") || c == "_predefinedid") {
			return fmt.Sprintf("to_jsonb(onec.uuid(j->>'%s'))", c)
		}
		if ci[c].Udt == "mchar" {
			return fmt.Sprintf("to_jsonb(rtrim(j->>'%s'))", c)
		}
		return fmt.Sprintf("j->'%s'", c)
	}
	parts := make([]string, 0, len(st))
	for _, c := range st {
		k := reSuffix.FindStringSubmatch(c)
		key := c
		if k != nil {
			key = k[1]
		}
		if k != nil && k[1] == "rrref" {
			parts = append(parts, fmt.Sprintf("'%s', to_jsonb(onec.uuid(j->>'%s'))", key, c))
		} else {
			parts = append(parts, fmt.Sprintf("'%s', j->'%s'", key, c))
		}
	}
	return "jsonb_strip_nulls(jsonb_build_object(" + strings.Join(parts, ", ") + "))"
}

// jsonbObject — jsonb_build_object частями по 40 пар (ограничение 100 аргументов функции).
func jsonbObject(pairs []string) string {
	if len(pairs) == 0 {
		return "'{}'::jsonb"
	}
	var chunks []string
	for i := 0; i < len(pairs); i += 40 {
		end := i + 40
		if end > len(pairs) {
			end = len(pairs)
		}
		chunks = append(chunks, "jsonb_build_object(\n      "+strings.Join(pairs[i:end], ",\n      ")+")")
	}
	return "jsonb_strip_nulls(" + strings.Join(chunks, "\n    || ") + ")"
}

var commonCols = []genCol{
	{Name: "version", Type: "bigint not null default 1", Comment: "версия строки: оптимистическая блокировка, события WS (план, раздел 11)"},
	{Name: "created_at", Type: "timestamptz not null default now()", Comment: "создание записи в vitauto_app"},
	{Name: "updated_at", Type: "timestamptz not null default now()", Comment: "последнее изменение записи в vitauto_app"},
	{Name: "deleted", Type: "boolean not null default false", Comment: "пометка удаления"},
	{Name: "onec_version", Type: "text", Comment: "ВерсияДанных 1С на момент переноса"},
	{Name: "extra", Type: "jsonb not null default '{}'", Comment: "поля 1С, не названные в карте storage-map (имена 1С)"},
	{Name: "import_batch_id", Type: "uuid", Comment: "партия импорта, создавшая или изменившая запись (план, раздел 12)"},
}

func renderDDL(list []*genTarget) string {
	var b strings.Builder
	b.WriteString("-- +goose Up\n-- Сгенерировано `vitauto-migrator gen` из docs/migration/storage-map.json, типов реквизитов 1С и типов столбцов источника.\n-- Не править вручную: правила — в tools/migration/storage-map.mjs и backend/internal/migrate/gen.go.\n\n")
	var fks []string
	for _, g := range list {
		have := map[string]bool{}
		var defs []string
		var comments []string
		for _, c := range g.Cols {
			have[c.Name] = true
			typ := c.Type
			if c.Name == "deleted" {
				typ = "boolean not null default false"
			}
			defs = append(defs, fmt.Sprintf("  %s %s", quoteIdent(c.Name), typ))
			if c.Comment != "" {
				comments = append(comments, fmt.Sprintf("comment on column %s.%s is %s;", qn(g.Name), quoteIdent(c.Name), quoteLit(c.Comment)))
			}
			if c.FK != "" {
				fks = append(fks, fmt.Sprintf("alter table %s add foreign key (%s) references %s (id) deferrable initially deferred;", qn(g.Name), quoteIdent(c.Name), qn(c.FK)))
			}
		}
		extraCols := append([]genCol{}, commonCols...)
		if g.Kind == kindReg {
			extraCols = append(extraCols, genCol{Name: "onec_key", Type: "text not null unique", Comment: "ключ записи регистра 1С (регистратор:строка или md5 записи)"})
		}
		if g.Shared {
			extraCols = append(extraCols, genCol{Name: "onec_table", Type: "text not null", Comment: "таблица 1С источника (общая таблица для нескольких объектов)"})
		}
		for _, c := range extraCols {
			if have[c.Name] {
				continue
			}
			defs = append(defs, fmt.Sprintf("  %s %s", c.Name, c.Type))
			if c.Comment != "" {
				comments = append(comments, fmt.Sprintf("comment on column %s.%s is %s;", qn(g.Name), c.Name, quoteLit(c.Comment)))
			}
		}
		srcs := make([]string, 0, len(g.Sources))
		for _, s := range g.Sources {
			srcs = append(srcs, fmt.Sprintf("%s (%s)", s.MT.Table, s.MT.Storage))
		}
		fmt.Fprintf(&b, "create table %s (\n%s\n);\n", qn(g.Name), strings.Join(defs, ",\n"))
		fmt.Fprintf(&b, "comment on table %s is %s;\n", qn(g.Name), quoteLit("1С: "+strings.Join(srcs, "; ")))
		for _, c := range comments {
			b.WriteString(c + "\n")
		}
		b.WriteString("\n")
	}
	sort.Strings(fks)
	b.WriteString("-- внешние ключи между перенесёнными объектами (проверка в конце транзакции загрузки)\n")
	for _, f := range fks {
		b.WriteString(f + "\n")
	}
	b.WriteString("\n-- +goose Down\n")
	for i := len(list) - 1; i >= 0; i-- {
		fmt.Fprintf(&b, "drop table if exists %s cascade;\n", qn(list[i].Name))
	}
	return b.String()
}

func renderLoad(list []*genTarget) string {
	var b strings.Builder
	b.WriteString("-- Сгенерировано `vitauto-migrator gen`: загрузка typed-таблиц из onec.raw (сырые строки 1С). Выполняется `vitauto-migrator load`\n-- одной транзакцией: очистка, вставка в порядке зависимостей, проверка внешних ключей при фиксации.\n\n")
	names := make([]string, 0, len(list))
	for _, g := range list {
		names = append(names, qn(g.Name))
	}
	// cascade: зависимые доменные таблицы (ref.storage_cell и др.) заполняет заново шаг derive
	fmt.Fprintf(&b, "truncate %s cascade;\n\n", strings.Join(names, ", "))
	for _, g := range list {
		for _, s := range g.Sources {
			var cols, exprs []string
			for _, c := range s.Cols {
				cols = append(cols, quoteIdent(c.Name))
				exprs = append(exprs, c.Expr)
			}
			cols = append(cols, "extra")
			exprs = append(exprs, s.Extra)
			if g.Kind == kindReg {
				cols = append(cols, "onec_key")
				exprs = append(exprs, s.KeyExpr)
			}
			if g.Shared {
				cols = append(cols, "onec_table")
				exprs = append(exprs, quoteLit(s.MT.Table))
			}
			fmt.Fprintf(&b, "-- %s (%s)\ninsert into %s (%s)\nselect\n    %s\nfrom onec.raw r cross join lateral (select r.row as j) x\nwhere r.storage = %s;\n\n",
				s.MT.Table, s.MT.Storage, qn(g.Name), strings.Join(cols, ", "), strings.Join(exprs, ",\n    "), quoteLit(s.MT.Storage))
		}
	}
	return b.String()
}

func quoteIdent(s string) string {
	if regexp.MustCompile(`^[a-z_][a-z0-9_]*$`).MatchString(s) && !reserved[s] {
		return s
	}
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

var reserved = map[string]bool{"order": true, "user": true, "end": true, "from": true, "to": true, "default": true, "group": true, "check": true}

func quoteLit(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// qn — имя таблицы schema.table с кавычками, где нужно (auth."user").
func qn(name string) string {
	p := strings.SplitN(name, ".", 2)
	if len(p) == 2 {
		return quoteIdent(p[0]) + "." + quoteIdent(p[1])
	}
	return quoteIdent(name)
}

// GenerateArmFields — Go-описание полей строки АРМ (поле 1С → столбец arm.line и вид значения) для PATCH /lines/{id}:
// PWA передаёт имя поля регистра 1С (Количество, Номенклатура …). Пишется в backend/internal/arm/fields_gen.go.
func GenerateArmFields(meta *onec.Meta, cols map[string]map[string]ColInfo) (string, error) {
	var mt *onec.MapTable
	for i := range meta.Map.Tables {
		if meta.Map.Tables[i].Target == "arm.line" {
			mt = &meta.Map.Tables[i]
		}
	}
	if mt == nil {
		return "", fmt.Errorf("в карте нет arm.line")
	}
	types := meta.Types[onec.ObjectOf(mt.Table)]
	var b strings.Builder
	b.WriteString("// Code generated by vitauto-migrator gen; DO NOT EDIT.\n// Источник: docs/migration/storage-map.json (arm.line), типы реквизитов 1С, типы столбцов vitauto_dev.\n\npackage arm\n\n")
	b.WriteString("// Fields — поле регистра Арм_ДанныеЗакупокИПродаж → столбец arm.line и вид значения.\nvar Fields = map[string]Field{\n")
	for _, f := range mt.Fields {
		if f.Column == nil || len(f.Storage) != 1 {
			continue
		}
		col := *f.Column
		if col == "id" {
			col = "onec_record_id"
		}
		typ, _ := scalar(f.Storage[0], cols[mt.Storage][f.Storage[0]])
		kind := map[string]string{"uuid": "ref", "boolean": "bool", "timestamp": "date", "text": "text", "integer": "number", "bigint": "number"}[typ]
		if strings.HasPrefix(typ, "numeric") {
			kind = "number"
		}
		if tl := types[f.Onec]; kind == "ref" && allEnum(tl) {
			kind = "enum"
		}
		fmt.Fprintf(&b, "\t%q: {Column: %q, Kind: %q},\n", f.Onec, col, kind)
	}
	b.WriteString("}\n")
	return b.String(), nil
}
