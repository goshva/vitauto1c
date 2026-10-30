package migrate

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"vitauto/backend/internal/onec"
)

// checkResult — итог одной проверки сверки (план, раздел 9).
type checkResult struct {
	ID, Title string
	Diffs     int
	Details   []string
}

type reconcileCtx struct {
	m    *Migrator
	meta *onec.Meta
	src  *pgx.Conn
	db   *pgxpool.Pool
	dec  *onec.Decoder
}

var allChecks = []string{"R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "UUID", "COMMENTS"}

// Reconcile выполняет проверки и пишет отчёт docs/migration/reconcile-<дата>.md; при любом расхождении — ошибка.
func (m *Migrator) Reconcile(ctx context.Context, checks []string) (err error) {
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
	_, finish := m.run(ctx, db, "reconcile")
	stats := map[string]any{}
	defer func() { finish(err, stats) }()
	enums, err := enumIndex(ctx, db)
	if err != nil {
		return err
	}
	rc := &reconcileCtx{m: m, meta: meta, src: src, db: db, dec: &onec.Decoder{Meta: meta, Enums: enums}}
	want := map[string]bool{}
	for _, c := range checks {
		c = strings.ToUpper(strings.TrimSpace(c))
		if c == "ALL" {
			for _, a := range allChecks {
				want[a] = true
			}
		} else if c != "" {
			want[c] = true
		}
	}
	fns := map[string]func(context.Context) checkResult{
		"R1": rc.r1, "R2": rc.r2, "R3": rc.r3, "R4": rc.r4, "R5": rc.r5, "R6": rc.r6, "R7": rc.r7, "R8": rc.r8,
		"UUID": rc.uuidCheck, "COMMENTS": rc.comments, "IDEMPOTENT": rc.idempotent,
	}
	var results []checkResult
	for _, id := range append(allChecks, "IDEMPOTENT") {
		if !want[id] {
			continue
		}
		start := time.Now()
		r := fns[id](ctx)
		m.Log("reconcile %s: расхождений %d (%s)", id, r.Diffs, time.Since(start).Round(time.Millisecond))
		for _, d := range r.Details {
			if len(r.Details) > 0 && r.Diffs > 0 {
				m.Log("  %s", d)
			}
		}
		results = append(results, r)
		delete(want, id)
	}
	for id := range want {
		return fmt.Errorf("неизвестная проверка %s (есть: %s, IDEMPOTENT, ALL)", id, strings.Join(allChecks, ", "))
	}
	total := 0
	for _, r := range results {
		total += r.Diffs
		stats[r.ID] = r.Diffs
	}
	full := true
	for _, a := range allChecks {
		full = full && stats[a] != nil
	}
	if err := m.writeReport(results, total, full); err != nil {
		return err
	}
	if total > 0 {
		return fmt.Errorf("расхождений: %d", total)
	}
	return nil
}

// writeReport: полная сверка (все R и UUID, COMMENTS) — docs/migration/reconcile-<дата>.md (протокол для G11.1),
// частичная (гейты отдельных этапов) — docs/migration/last-reconcile.md.
func (m *Migrator) writeReport(results []checkResult, total int, full bool) error {
	var b strings.Builder
	fmt.Fprintf(&b, "# Сверка миграции %s\n\nИсточник: `%s` (копия 1С), приёмник: `vitauto_app`. Команда: `vitauto-migrator reconcile`.\n\n",
		time.Now().Format("2006-01-02 15:04"), m.SourceBase)
	b.WriteString("| Проверка | Что сверяется | Расхождений | Подробности |\n|---|---|---|---|\n")
	for _, r := range results {
		det := strings.Join(r.Details, "; ")
		if len(det) > 1500 {
			det = det[:1500] + " …"
		}
		fmt.Fprintf(&b, "| %s | %s | %d | %s |\n", r.ID, r.Title, r.Diffs, strings.ReplaceAll(det, "|", "/"))
	}
	fmt.Fprintf(&b, "\nРасхождений: %d\n", total)
	name := filepath.Join(m.Root, "docs", "migration", "last-reconcile.md")
	if full {
		name = filepath.Join(m.Root, "docs", "migration", "reconcile-"+time.Now().Format("2006-01-02")+".md")
	}
	return os.WriteFile(name, []byte(b.String()), 0o644)
}

func (rc *reconcileCtx) count(ctx context.Context, conn interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, table string) (int64, error) {
	var n int64
	p := strings.SplitN(table, ".", 2)
	id := pgx.Identifier{table}
	if len(p) == 2 {
		id = pgx.Identifier{p[0], p[1]}
	}
	err := conn.QueryRow(ctx, "select count(*) from "+id.Sanitize()).Scan(&n)
	return n, err
}

// R1: число записей каждого непустого объекта 1С = записи legacy.object (+ строки табличных частей).
func (rc *reconcileCtx) r1(ctx context.Context) checkResult {
	r := checkResult{ID: "R1", Title: "записей каждого непустого объекта 1С (основные таблицы и табличные части) = legacy.object"}
	var objs, rows int64
	for _, o := range legacyObjects(rc.meta) {
		var srcMain, srcTP int64
		for _, t := range o.Tables {
			n, err := rc.count(ctx, rc.src, "public."+t.Storage)
			if err != nil {
				r.Diffs++
				r.Details = append(r.Details, fmt.Sprintf("%s: %v", t.Storage, err))
				continue
			}
			if t.Purpose == "ТабличнаяЧасть" {
				srcTP += n
			} else {
				srcMain += n
			}
		}
		var main, orphan, tp int64
		err := rc.db.QueryRow(ctx, `select count(*) filter (where key not like 'tp:%'), count(*) filter (where key like 'tp:%'),
			coalesce(sum((select sum(jsonb_array_length(v)) from jsonb_each(data->'ТабличныеЧасти') e(k, v))), 0)
			from legacy.object where name = $1`, o.Object).Scan(&main, &orphan, &tp)
		if err != nil || main != srcMain || tp+orphan != srcTP {
			r.Diffs++
			r.Details = append(r.Details, fmt.Sprintf("%s: 1С %d+%d, legacy %d+%d %v", o.Object, srcMain, srcTP, main, tp+orphan, err))
		}
		objs++
		rows += srcMain + srcTP
	}
	r.Details = append(r.Details, fmt.Sprintf("объектов %d, строк 1С %d", objs, rows))
	return r
}

// R2: число записей каждой typed-таблицы = источник.
func (rc *reconcileCtx) r2(ctx context.Context) checkResult {
	r := checkResult{ID: "R2", Title: "записей в типизированных таблицах = таблицы 1С по карте storage-map"}
	shared := map[string]int{}
	for _, t := range rc.meta.Map.Tables {
		if t.Rule == "typed" {
			shared[t.Target]++
		}
	}
	var n int
	for _, t := range rc.meta.Map.Tables {
		if t.Rule != "typed" {
			continue
		}
		s, err := rc.count(ctx, rc.src, "public."+t.Storage)
		if err != nil {
			r.Diffs++
			r.Details = append(r.Details, err.Error())
			continue
		}
		var d int64
		p := strings.SplitN(t.Target, ".", 2)
		q := "select count(*) from " + pgx.Identifier{p[0], p[1]}.Sanitize()
		args := []any{}
		if shared[t.Target] > 1 {
			q += " where onec_table = $1"
			args = append(args, t.Table)
		}
		if err := rc.db.QueryRow(ctx, q, args...).Scan(&d); err != nil || d != s {
			r.Diffs++
			r.Details = append(r.Details, fmt.Sprintf("%s → %s: 1С %d, vitauto_app %d %v", t.Table, t.Target, s, d, err))
		}
		n++
	}
	r.Details = append(r.Details, fmt.Sprintf("таблиц %d", n))
	return r
}

// R3: хеш каждой записи архива, собранной заново прямо из источника, = legacy.object.hash.
func (rc *reconcileCtx) r3(ctx context.Context) checkResult {
	r := checkResult{ID: "R3", Title: "хеш каждой записи, собранной заново из базы 1С, = legacy.object.hash"}
	var n int
	for _, o := range legacyObjects(rc.meta) {
		objs, _, err := buildLegacy(ctx, rc.dec, o, rawFromSource(rc.src))
		if err != nil {
			r.Diffs++
			r.Details = append(r.Details, fmt.Sprintf("%s: %v", o.Object, err))
			continue
		}
		have := map[string]string{}
		rows, err := rc.db.Query(ctx, "select key, hash from legacy.object where name = $1", o.Object)
		if err != nil {
			r.Diffs++
			continue
		}
		for rows.Next() {
			var k, h string
			_ = rows.Scan(&k, &h)
			have[k] = h
		}
		rows.Close()
		for _, x := range objs {
			_, h := onec.Canonical(x.Data)
			if have[x.Key] != h {
				r.Diffs++
				if len(r.Details) < 20 {
					r.Details = append(r.Details, fmt.Sprintf("%s %s", o.Object, x.Key))
				}
			}
			delete(have, x.Key)
			n++
		}
		if len(have) > 0 {
			r.Diffs += len(have)
			r.Details = append(r.Details, fmt.Sprintf("%s: лишних в legacy %d", o.Object, len(have)))
		}
	}
	r.Details = append(r.Details, fmt.Sprintf("записей %d", n))
	return r
}

// R4: внешние ключи действуют; пары <поле>_type + <поле>_id указывают на существующие записи (typed или legacy).
func (rc *reconcileCtx) r4(ctx context.Context) checkResult {
	r := checkResult{ID: "R4", Title: "внешние ключи и составные ссылки (_type + _id) разрешаются в vitauto_app или legacy.object"}
	var fk, invalid int
	_ = rc.db.QueryRow(ctx, `select count(*), count(*) filter (where not convalidated) from pg_constraint c
		join pg_namespace n on n.oid = c.connamespace where c.contype = 'f' and n.nspname in ('ref','doc','stock','arm','auth')`).Scan(&fk, &invalid)
	if invalid > 0 {
		r.Diffs += invalid
		r.Details = append(r.Details, fmt.Sprintf("непроверенных внешних ключей %d", invalid))
	}
	rows, err := rc.db.Query(ctx, `select a.table_schema, a.table_name, left(a.column_name, length(a.column_name) - 5)
		from information_schema.columns a join information_schema.columns b
		  on b.table_schema = a.table_schema and b.table_name = a.table_name and b.column_name = left(a.column_name, length(a.column_name) - 5) || '_id'
		where a.column_name like '%\_type' and a.table_schema in ('ref','doc','stock','arm','auth')`)
	if err != nil {
		r.Diffs++
		r.Details = append(r.Details, err.Error())
		return r
	}
	type pair struct{ s, t, base string }
	var pairs []pair
	for rows.Next() {
		var p pair
		_ = rows.Scan(&p.s, &p.t, &p.base)
		pairs = append(pairs, p)
	}
	rows.Close()
	var checked, orphans int64
	for _, p := range pairs {
		tbl := pgx.Identifier{p.s, p.t}.Sanitize()
		ty, id := pgx.Identifier{p.base + "_type"}.Sanitize(), pgx.Identifier{p.base + "_id"}.Sanitize()
		trows, err := rc.db.Query(ctx, fmt.Sprintf("select distinct %s from %s where %s is not null and %s is not null", ty, tbl, id, ty))
		if err != nil {
			continue
		}
		var types []string
		for trows.Next() {
			var s string
			_ = trows.Scan(&s)
			types = append(types, s)
		}
		trows.Close()
		for _, t := range types {
			var n, o int64
			var q string
			if regexp.MustCompile(`^[a-z]+\.[a-z_]+$`).MatchString(t) {
				q2 := strings.SplitN(t, ".", 2)
				q = fmt.Sprintf("select count(*), count(*) filter (where not exists (select 1 from %s x where x.id = s.%s)) from %s s where %s = $1 and %s is not null",
					pgx.Identifier{q2[0], q2[1]}.Sanitize(), id, tbl, ty, id)
			} else {
				q = fmt.Sprintf("select count(*), count(*) filter (where not exists (select 1 from legacy.object x where x.name = s.%s and x.key = s.%s::text)) from %s s where %s = $1 and %s is not null",
					ty, id, tbl, ty, id)
			}
			if err := rc.db.QueryRow(ctx, q, t).Scan(&n, &o); err != nil {
				r.Diffs++
				r.Details = append(r.Details, fmt.Sprintf("%s.%s %s: %v", p.t, p.base, t, err))
				continue
			}
			checked += n
			if o > 0 {
				orphans += o
				r.Diffs += int(o)
				r.Details = append(r.Details, fmt.Sprintf("%s.%s.%s → %s: не найдено %d", p.s, p.t, p.base, t, o))
			}
		}
	}
	r.Details = append(r.Details, fmt.Sprintf("внешних ключей %d, составных ссылок проверено %d, не найдено %d", fk, checked, orphans))
	return r
}

// UUID (G2.3): id каждого справочника и документа = UUID ссылки 1С.
func (rc *reconcileCtx) uuidCheck(ctx context.Context) checkResult {
	r := checkResult{ID: "UUID", Title: "id справочников и документов = Ref_Key 1С (onec.uuid(_IDRRef)), 100 %"}
	var n int
	for _, t := range rc.meta.Map.Tables {
		if t.Rule != "typed" || t.Purpose != "Основная" || kindOf(t) != kindRef {
			continue
		}
		srcIDs := map[uuid.UUID]bool{}
		rows, err := rc.src.Query(ctx, fmt.Sprintf("select _idrref from public.%s", pgx.Identifier{t.Storage}.Sanitize()))
		if err != nil {
			r.Diffs++
			continue
		}
		for rows.Next() {
			var b []byte
			_ = rows.Scan(&b)
			if u, ok, _ := onec.UUIDFromIDRRef(b); ok {
				srcIDs[u] = true
			}
		}
		rows.Close()
		p := strings.SplitN(t.Target, ".", 2)
		trows, err := rc.db.Query(ctx, "select id from "+pgx.Identifier{p[0], p[1]}.Sanitize())
		if err != nil {
			r.Diffs++
			continue
		}
		var extra int
		for trows.Next() {
			var u uuid.UUID
			_ = trows.Scan(&u)
			if !srcIDs[u] {
				extra++
			}
			delete(srcIDs, u)
		}
		trows.Close()
		if extra > 0 || len(srcIDs) > 0 {
			r.Diffs += extra + len(srcIDs)
			r.Details = append(r.Details, fmt.Sprintf("%s: нет в vitauto_app %d, лишних %d", t.Table, len(srcIDs), extra))
		}
		n++
	}
	r.Details = append(r.Details, fmt.Sprintf("таблиц %d", n))
	return r
}

// COMMENTS (G2.4): у каждого столбца перенесённых таблиц есть комментарий с источником.
func (rc *reconcileCtx) comments(ctx context.Context) checkResult {
	r := checkResult{ID: "COMMENTS", Title: "у каждого столбца таблиц ref, doc, stock, arm, auth есть COMMENT (источник в 1С)"}
	rows, err := rc.db.Query(ctx, `select c.table_schema || '.' || c.table_name || '.' || c.column_name from information_schema.columns c
		join pg_class t on t.relname = c.table_name join pg_namespace n on n.oid = t.relnamespace and n.nspname = c.table_schema
		where c.table_schema in ('ref','doc','stock','arm','auth') and t.relkind = 'r'
		  and col_description(t.oid, c.ordinal_position) is null order by 1`)
	if err != nil {
		r.Diffs++
		r.Details = append(r.Details, err.Error())
		return r
	}
	defer rows.Close()
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		r.Diffs++
		if len(r.Details) < 30 {
			r.Details = append(r.Details, s)
		}
	}
	return r
}

// num — точное десятичное значение (json.Number, строка, число).
func num(v any) *big.Rat {
	x := new(big.Rat)
	switch t := v.(type) {
	case json.Number:
		x.SetString(t.String())
	case string:
		x.SetString(t)
	case float64:
		x.SetFloat64(t)
	case int64:
		x.SetInt64(t)
	}
	return x
}

// R5: остатки stock.balance = сумма движений регистра Запасы 1С (приход +, расход −) по ключу.
func (rc *reconcileCtx) r5(ctx context.Context) checkResult {
	r := checkResult{ID: "R5", Title: "остатки stock.balance = движения регистра Запасы 1С по ключу (склад, номенклатура, партия, заказ)"}
	var storage string
	for _, t := range rc.meta.Map.Tables {
		if t.Table == "РегистрНакопления.Запасы" && t.Purpose == "Основная" {
			storage = t.Storage
		}
	}
	rows, err := rawFromSource(rc.src)(ctx, storage)
	if err != nil {
		r.Diffs++
		r.Details = append(r.Details, err.Error())
		return r
	}
	type bal struct{ qty, amount *big.Rat }
	src := map[string]*bal{}
	key := func(w, n, b, o any) string { return fmt.Sprintf("%v|%v|%v|%v", w, n, b, o) }
	for _, raw := range rows {
		d := rc.dec.Row(storage, raw)
		if a, ok := d["Активность"].(bool); ok && !a {
			continue
		}
		k := key(refID(d["СтруктурнаяЕдиница"]), nz(d["Номенклатура"]), nz(d["Партия"]), nz(refID(d["ЗаказПокупателя"])))
		if src[k] == nil {
			src[k] = &bal{new(big.Rat), new(big.Rat)}
		}
		sign := int64(1)
		if num(d["ВидДвижения"]).Sign() != 0 {
			sign = -1
		}
		src[k].qty.Add(src[k].qty, new(big.Rat).Mul(num(d["Количество"]), big.NewRat(sign, 1)))
		src[k].amount.Add(src[k].amount, new(big.Rat).Mul(num(d["Сумма"]), big.NewRat(sign, 1)))
	}
	trows, err := rc.db.Query(ctx, "select warehouse_id::text, nomenclature_id::text, batch_id::text, customer_order::text, qty::text, amount::text from stock.balance")
	if err != nil {
		r.Diffs++
		r.Details = append(r.Details, err.Error())
		return r
	}
	defer trows.Close()
	seen := map[string]bool{}
	var n int
	for trows.Next() {
		var w, nm, b, o, q, a *string
		_ = trows.Scan(&w, &nm, &b, &o, &q, &a)
		k := key(ptr(w), ptr(nm), ptr(b), ptr(o))
		seen[k] = true
		s := src[k]
		if s == nil {
			s = &bal{new(big.Rat), new(big.Rat)}
		}
		if s.qty.Cmp(num(ptr(q))) != 0 || s.amount.Cmp(num(ptr(a))) != 0 {
			r.Diffs++
			if len(r.Details) < 20 {
				r.Details = append(r.Details, fmt.Sprintf("%s: 1С %s / %s, vitauto_app %s / %s", k, s.qty.FloatString(3), s.amount.FloatString(2), ptr(q), ptr(a)))
			}
		}
		n++
	}
	for k, s := range src {
		if !seen[k] && (s.qty.Sign() != 0 || s.amount.Sign() != 0) {
			r.Diffs++
			r.Details = append(r.Details, fmt.Sprintf("%s: нет в stock.balance", k))
		}
	}
	r.Details = append(r.Details, fmt.Sprintf("ключей остатков %d, движений 1С %d", n, len(rows)))
	return r
}

func nz(v any) any {
	if v == nil {
		return "<nil>"
	}
	return v
}

func ptr(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

// R6: по каждому документу — число строк, количество и сумма табличных частей 1С = vitauto_app.
func (rc *reconcileCtx) r6(ctx context.Context) checkResult {
	r := checkResult{ID: "R6", Title: "по каждому документу: строк, Количество и Сумма табличных частей 1С = vitauto_app"}
	var docs int
	for _, t := range rc.meta.Map.Tables {
		// строки документов (doc.*); «Дополнительные реквизиты» и контакты — общие таблицы ref.*, они в R2
		if t.Rule != "typed" || t.Purpose != "ТабличнаяЧасть" || !strings.HasPrefix(t.Table, "Документ.") || !strings.HasPrefix(t.Target, "doc.") {
			continue
		}
		rows, err := rawFromSource(rc.src)(ctx, t.Storage)
		if err != nil {
			r.Diffs++
			continue
		}
		type agg struct {
			n          int
			qty, total *big.Rat
		}
		src := map[string]*agg{}
		for _, raw := range rows {
			d := rc.dec.Row(t.Storage, raw)
			k := fmt.Sprint(d["Ссылка"])
			if src[k] == nil {
				src[k] = &agg{0, new(big.Rat), new(big.Rat)}
			}
			src[k].n++
			src[k].qty.Add(src[k].qty, num(d["Количество"]))
			src[k].total.Add(src[k].total, num(d["Сумма"]))
		}
		cols := map[string]string{}
		for _, f := range t.Fields {
			if f.Column != nil {
				cols[f.Onec] = *f.Column
			}
		}
		qty, amount := "0", "0"
		if c := cols["Количество"]; c != "" {
			qty = "coalesce(sum(" + pgx.Identifier{c}.Sanitize() + "), 0)"
		}
		if c := cols["Сумма"]; c != "" {
			amount = "coalesce(sum(" + pgx.Identifier{c}.Sanitize() + "), 0)"
		}
		p := strings.SplitN(t.Target, ".", 2)
		trows, err := rc.db.Query(ctx, fmt.Sprintf("select doc_id::text, count(*), (%s)::text, (%s)::text from %s group by doc_id", qty, amount, pgx.Identifier{p[0], p[1]}.Sanitize()))
		if err != nil {
			r.Diffs++
			r.Details = append(r.Details, fmt.Sprintf("%s: %v", t.Target, err))
			continue
		}
		for trows.Next() {
			var id, q, a string
			var c int
			_ = trows.Scan(&id, &c, &q, &a)
			s := src[id]
			if s == nil || s.n != c || s.qty.Cmp(num(q)) != 0 || s.total.Cmp(num(a)) != 0 {
				r.Diffs++
				if len(r.Details) < 20 {
					r.Details = append(r.Details, fmt.Sprintf("%s %s", t.Table, id))
				}
			}
			delete(src, id)
			docs++
		}
		trows.Close()
		r.Diffs += len(src)
	}
	r.Details = append(r.Details, fmt.Sprintf("документов с табличными частями %d", docs))
	return r
}

// R7: строки АРМ — все поля 1С совпадают со столбцами arm.line.
func (rc *reconcileCtx) r7(ctx context.Context) checkResult {
	r := checkResult{ID: "R7", Title: "строки АРМ: каждое поле 1С = столбец arm.line"}
	var mt *onec.MapTable
	for i := range rc.meta.Map.Tables {
		if rc.meta.Map.Tables[i].Target == "arm.line" {
			mt = &rc.meta.Map.Tables[i]
		}
	}
	rows, err := rawFromSource(rc.src)(ctx, mt.Storage)
	if err != nil {
		r.Diffs++
		return r
	}
	target := map[string]map[string]any{}
	trows, err := rc.db.Query(ctx, "select onec_record_id, to_jsonb(l)::text from arm.line l")
	if err != nil {
		r.Diffs++
		r.Details = append(r.Details, err.Error())
		return r
	}
	for trows.Next() {
		var id, j string
		_ = trows.Scan(&id, &j)
		target[id], _ = onec.ParseRow([]byte(j))
	}
	trows.Close()
	perField := map[string]int{}
	var fields int
	for _, raw := range rows {
		d := rc.dec.Row(mt.Storage, raw)
		id := fmt.Sprint(d["ИдентификаторЗаписи"])
		t := target[id]
		if t == nil {
			r.Diffs++
			r.Details = append(r.Details, "нет строки "+id)
			continue
		}
		for _, f := range mt.Fields {
			if f.Column == nil {
				continue
			}
			col := *f.Column
			if col == "id" {
				col = "onec_record_id"
			}
			fields++
			if norm(d[f.Onec]) != norm(t[col]) {
				r.Diffs++
				perField[f.Onec]++
				if perField[f.Onec] <= 2 {
					r.Details = append(r.Details, fmt.Sprintf("%s.%s: 1С %v, arm.line %v", id, f.Onec, d[f.Onec], t[col]))
				}
			}
		}
		delete(target, id)
	}
	if len(target) > 0 {
		r.Diffs += len(target)
		r.Details = append(r.Details, fmt.Sprintf("лишних строк в arm.line %d", len(target)))
	}
	r.Details = append(r.Details, fmt.Sprintf("строк %d, сравнено значений %d", len(rows), fields))
	return r
}

// norm — значение для сравнения: пусто/NULL/пустая дата одинаковы, числа точно, перечисление — имя значения.
func norm(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case json.Number:
		return num(t).RatString()
	case float64:
		return num(t).RatString()
	case bool:
		return fmt.Sprint(t)
	case string:
		s := strings.TrimRight(t, " ")
		if strings.HasPrefix(s, "0001-01-01") {
			return ""
		}
		if strings.HasPrefix(s, "Перечисление.") {
			return s[strings.LastIndex(s, ".")+1:]
		}
		return s
	case map[string]any:
		if id, ok := t["id"]; ok {
			return norm(id)
		}
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// IDEMPOTENT (G3.2): повторный перенос даёт те же данные (контрольные суммы legacy и всех таблиц).
func (rc *reconcileCtx) idempotent(ctx context.Context) checkResult {
	r := checkResult{ID: "IDEMPOTENT", Title: "повторный перенос (extract → legacy → load → derive) не меняет данные"}
	before, err := checksums(ctx, rc.db)
	if err != nil {
		r.Diffs++
		r.Details = append(r.Details, err.Error())
		return r
	}
	for _, step := range []func(context.Context) error{rc.m.Extract, rc.m.Legacy, rc.m.Load, rc.m.Derive} {
		if err := step(ctx); err != nil {
			r.Diffs++
			r.Details = append(r.Details, err.Error())
			return r
		}
	}
	after, err := checksums(ctx, rc.db)
	if err != nil {
		r.Diffs++
		return r
	}
	var names []string
	for k := range before {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, k := range names {
		if before[k] != after[k] {
			r.Diffs++
			r.Details = append(r.Details, k)
		}
	}
	r.Details = append(r.Details, fmt.Sprintf("контрольных сумм %d", len(names)))
	return r
}

func checksums(ctx context.Context, db *pgxpool.Pool) (map[string]string, error) {
	out := map[string]string{}
	var h string
	if err := db.QueryRow(ctx, "select md5(coalesce(string_agg(hash, '' order by kind, name, key), '')) from legacy.object").Scan(&h); err != nil {
		return nil, err
	}
	out["legacy.object"] = h
	rows, err := db.Query(ctx, `select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
		where c.relkind = 'r' and n.nspname in ('ref','doc','stock','arm','auth','sys') and c.relname not in ('migration_run') order by 1, 2`)
	if err != nil {
		return nil, err
	}
	var tables [][2]string
	for rows.Next() {
		var s, t string
		_ = rows.Scan(&s, &t)
		tables = append(tables, [2]string{s, t})
	}
	rows.Close()
	for _, t := range tables {
		id := pgx.Identifier{t[0], t[1]}.Sanitize()
		q := fmt.Sprintf("select md5(coalesce(string_agg(md5((to_jsonb(x) - 'created_at' - 'updated_at')::text), '' order by md5((to_jsonb(x) - 'created_at' - 'updated_at')::text)), '')) from %s x", id)
		if err := db.QueryRow(ctx, q).Scan(&h); err != nil {
			return nil, err
		}
		out[t[0]+"."+t[1]] = h
	}
	return out, nil
}
