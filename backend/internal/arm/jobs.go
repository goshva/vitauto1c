package arm

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Job — задание «В работе» (POST /sales/jobs → GET /jobs/{id}).
type Job struct {
	ID        uuid.UUID `json:"id"`
	State     string    `json:"state"`
	Message   string    `json:"message"`
	Processed *int      `json:"processed,omitempty"`
}

// GetJob — GET /jobs/{id}.
func (s *Service) GetJob(ctx context.Context, id string) (*Job, error) {
	jid, err := uuid.Parse(id)
	if err != nil {
		return nil, fail(404, "not_found", "Задание не найдено")
	}
	var j Job
	err = s.DB.QueryRow(ctx, "select id, state, message, processed from arm.job where id = $1", jid).Scan(&j.ID, &j.State, &j.Message, &j.Processed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail(404, "not_found", "Задание не найдено")
	}
	return &j, err
}

// orderMetrics — анализ заказа (запрос сплита СформироватьЗаказыФоновоеЗадание).
type orderMetrics struct {
	needSplit, purchasesMarked bool
	selected                   int
	totalQty, markedQty        float64
}

// InWork — POST /sales/jobs, «В работе» (M4, K5): отмеченные ключи в «Черновик», «В работе», «Собран» →
// заказы поставщикам по закупкам или проведение заказа и расходная накладная по продажам; сплит заказа.
// Выполняется сразу; итог сохраняется в arm.job.
func (s *Service) InWork(ctx context.Context, a Actor, allowSplit bool) (*Job, error) {
	if err := requireUser(a); err != nil {
		return nil, err
	}
	if a.Role != "manager" && a.Role != "admin" {
		return nil, fail(403, "forbidden", "Действие доступно менеджеру и администратору АРМ.")
	}
	job := &Job{ID: uuid.Must(uuid.NewV7()), State: "failed"}
	var processed int
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		keys, err := markedKeys(ctx, tx, a, []string{stDraft, stInWork, stAssembled})
		if err != nil {
			return err
		}
		if len(keys) == 0 {
			return fail(409, "nothing_marked", "Нет отмеченных строк в статусах «Черновик», «В работе», «Собран»")
		}
		orders, err := ordersOfKeys(ctx, tx, keys)
		if err != nil {
			return err
		}
		if len(orders) == 0 {
			return fmt.Errorf("Отсутствуют документы для обработки")
		}
		metrics, totalSel, totalAll, needSplit, err := analyseOrders(ctx, tx, orders, keys)
		if err != nil {
			return err
		}
		if needSplit && !allowSplit {
			job.State = "need_split"
			job.Message = fmt.Sprintf("Выбраны не все позиции по заказам (отмечено %s из %s). Повторите с allowSplit=true", trim(totalSel), trim(totalAll))
			return nil
		}
		if err := s.processOrders(ctx, tx, a, orders, keys, metrics); err != nil {
			return err
		}
		processed = len(keys)
		job.State, job.Message = "done", describe(metrics)
		return nil
	})
	if err != nil {
		p := AsProblem(err)
		if p.Status == 500 || p.Code == "validation" {
			job.State, job.Message = "failed", "Процесс прерван: "+p.Message
		} else {
			return nil, err
		}
	}
	if job.State == "done" {
		job.Processed = &processed
	}
	if _, e := s.DB.Exec(ctx, "insert into arm.job (id, kind, state, message, processed, created_by, finished_at) values ($1, 'in_work', $2, $3, $4, $5, now())",
		job.ID, job.State, job.Message, job.Processed, nullable(a.UserID)); e != nil {
		return nil, e
	}
	return job, nil
}

func trim(x float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.3f", x), "0"), ".")
}

// markedKeys — ПолучитьМассивОтмеченныхКлючейСвязи: ключи связи отмеченных пользователем строк в статусах.
func markedKeys(ctx context.Context, tx pgx.Tx, a Actor, statuses []string) ([]string, error) {
	rows, err := tx.Query(ctx, `select distinct link_key from arm.line where marked and marked_by_id = $1 and not coalesce(deleted, false)
		and status = any($2) and link_key is not null`, a.UserID, statuses)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func ordersOfKeys(ctx context.Context, tx pgx.Tx, keys []string) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, "select distinct customer_order_id from arm.line where link_key = any($1) and not coalesce(deleted, false) and customer_order_id is not null order by 1", keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var u uuid.UUID
		_ = rows.Scan(&u)
		out = append(out, u)
	}
	return out, rows.Err()
}

func analyseOrders(ctx context.Context, tx pgx.Tx, orders []uuid.UUID, keys []string) (map[uuid.UUID]*orderMetrics, float64, float64, bool, error) {
	rows, err := tx.Query(ctx, `select customer_order_id,
		bool_or(operation = 'Закупка' and coalesce(marked, false)),
		coalesce(sum(case when operation = 'Продажа' then quantity else 0 end), 0)::float8,
		coalesce(sum(case when operation = 'Продажа' and link_key = any($2) then quantity else 0 end), 0)::float8,
		count(*) filter (where operation = 'Продажа'), count(*) filter (where operation = 'Продажа' and link_key = any($2)),
		count(distinct case when coalesce(marked, false) then id end)
		from arm.line where not coalesce(deleted, false) and customer_order_id = any($1) group by customer_order_id`, orders, keys)
	if err != nil {
		return nil, 0, 0, false, err
	}
	defer rows.Close()
	out := map[uuid.UUID]*orderMetrics{}
	var sel, all float64
	split := false
	for rows.Next() {
		var id uuid.UUID
		var m orderMetrics
		var salesRows, markedRows int
		if err := rows.Scan(&id, &m.purchasesMarked, &m.totalQty, &m.markedQty, &salesRows, &markedRows, &m.selected); err != nil {
			return nil, 0, 0, false, err
		}
		m.needSplit = salesRows > markedRows && markedRows > 0
		split = split || m.needSplit
		sel += m.markedQty
		all += m.totalQty
		out[id] = &m
	}
	return out, sel, all, split, rows.Err()
}

func describe(metrics map[uuid.UUID]*orderMetrics) string {
	var byPurchase, bySale int
	for _, m := range metrics {
		if m.purchasesMarked {
			byPurchase++
		} else if m.selected > 0 {
			bySale++
		}
	}
	var parts []string
	if byPurchase > 0 {
		parts = append(parts, fmt.Sprintf("Заказы поставщикам оформлены (заказов покупателей: %d)", byPurchase))
	}
	if bySale > 0 {
		parts = append(parts, fmt.Sprintf("Заказы покупателей проведены, расходные накладные оформлены: %d", bySale))
	}
	if len(parts) == 0 {
		return "Все документы оформлены"
	}
	return strings.Join(parts, ". ") + "."
}

// processOrders — ОбработатьОтмеченныеЗаказы: блокировка строк, проверки, ветки закупок и продаж, разблокировка.
func (s *Service) processOrders(ctx context.Context, tx pgx.Tx, a Actor, orders []uuid.UUID, keys []string, metrics map[uuid.UUID]*orderMetrics) error {
	original := map[uuid.UUID]string{}
	// ЗаблокироватьСтроки: «Черновик» и «В работе» строк заказов -> «ЗаблокированоФоном»
	rows, err := tx.Query(ctx, "select id, status from arm.line where customer_order_id = any($1) and not coalesce(deleted, false) and status in ('ВРаботе', 'Черновик') for update", orders)
	if err != nil {
		return err
	}
	var lock []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		var st string
		_ = rows.Scan(&id, &st)
		original[id] = st
		lock = append(lock, id)
	}
	rows.Close()
	if _, err := tx.Exec(ctx, "update arm.line set status = 'ЗаблокированоФоном', version = version + 1, updated_at = now() where id = any($1)", lock); err != nil {
		return err
	}
	var problems []string
	for _, o := range orders {
		ok, err := orderKeys(ctx, tx, o, keys)
		if err != nil {
			return err
		}
		if len(ok) == 0 || metrics[o] == nil {
			continue
		}
		var msg string
		if metrics[o].purchasesMarked {
			msg, err = validate(ctx, tx, ok, true)
		} else {
			msg, err = validate(ctx, tx, ok, false)
		}
		if err != nil {
			return err
		}
		if msg != "" {
			var number string
			_ = tx.QueryRow(ctx, "select number from doc.customer_order where id = $1", o).Scan(&number)
			problems = append(problems, fmt.Sprintf("• По заказу %s: %s", number, msg))
		}
	}
	if len(problems) > 0 {
		return &Problem{Status: 409, Code: "validation", Message: "Данные не прошли предварительную проверку:\n" + strings.Join(problems, "\n")}
	}
	for _, o := range orders {
		ok, err := orderKeys(ctx, tx, o, keys)
		if err != nil {
			return err
		}
		if len(ok) == 0 || metrics[o] == nil {
			continue
		}
		if metrics[o].purchasesMarked {
			if err := s.rebuildOrderForPurchases(ctx, tx, a, o, ok); err != nil {
				return err
			}
			if err := s.orderPurchases(ctx, tx, a, ok, original); err != nil {
				return err
			}
		} else if err := s.shipSales(ctx, tx, a, o, ok, original); err != nil {
			return err
		}
	}
	// РазблокироватьОставшиесяСтроки
	rows, err = tx.Query(ctx, "select id, operation from arm.line where customer_order_id = any($1) and status = 'ЗаблокированоФоном'", orders)
	if err != nil {
		return err
	}
	type rest struct {
		id uuid.UUID
		op string
	}
	var left []rest
	for rows.Next() {
		var r rest
		_ = rows.Scan(&r.id, &r.op)
		left = append(left, r)
	}
	rows.Close()
	for _, r := range left {
		st, ok := original[r.id]
		if !ok {
			st = stInWork
			if r.op == opPurchase {
				st = stDraft
			}
		}
		if err := updateLine(ctx, tx, r.id, map[string]any{"status": st}); err != nil {
			return err
		}
	}
	return nil
}

func orderKeys(ctx context.Context, tx pgx.Tx, order uuid.UUID, keys []string) ([]string, error) {
	rows, err := tx.Query(ctx, "select distinct link_key from arm.line where customer_order_id = $1 and link_key = any($2) and not coalesce(deleted, false)", order, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		out = append(out, k)
	}
	return out, rows.Err()
}

// validate — ВалидацияСтрокЗакупок / ВалидацияСтрокПродаж.
func validate(ctx context.Context, tx pgx.Tx, keys []string, purchases bool) (string, error) {
	var sql string
	if purchases {
		sql = `select distinct l.nomenclature_id, n.name, coalesce(l.fact_name, ''), e.msg from arm.line l left join ref.nomenclature n on n.id = l.nomenclature_id,
		lateral (values
			(case when l.operation = 'Закупка' and l.contract_id is null then 'Пустой договор поставщика' end),
			(case when coalesce(l.sale_price, 0) <= 0 then 'Нулевая цена' end),
			(case when coalesce(l.quantity, 0) <= 0 then 'Нулевое количество' end),
			(case when l.nomenclature_id is null then 'Проверьте сопоставление (пустая номенклатура)' end),
			(case when l.operation = 'Закупка' and l.supplier_id is null then 'Не указан поставщик для закупки' end)) e(msg)
		where l.link_key = any($1) and not coalesce(l.deleted, false) and e.msg is not null`
	} else {
		sql = `select distinct l.nomenclature_id, n.name, coalesce(l.fact_name, ''), e.msg from arm.line l left join ref.nomenclature n on n.id = l.nomenclature_id,
		lateral (values
			(case when l.batch_id is not null and l.shipment_date is null then 'Пустая дата отгрузки' end),
			(case when coalesce(l.sale_price, 0) <= 0 then 'Нулевая цена' end),
			(case when coalesce(l.quantity, 0) <= 0 then 'Нулевое количество' end),
			(case when l.nomenclature_id is null then 'Проверьте сопоставление (пустая номенклатура)' end)) e(msg)
		where l.link_key = any($1) and l.operation = 'Продажа' and not coalesce(l.deleted, false) and e.msg is not null`
	}
	rows, err := tx.Query(ctx, sql, keys)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var nom *uuid.UUID
		var name *string
		var fact, msg string
		_ = rows.Scan(&nom, &name, &fact, &msg)
		who := "Товар не сопоставлен"
		if name != nil {
			who = *name
		} else if fact != "" {
			who += " («" + strings.TrimSpace(fact) + "»)"
		}
		lines = append(lines, fmt.Sprintf("- %s: %s", who, msg))
	}
	sort.Strings(lines)
	if len(lines) == 0 {
		return "", rows.Err()
	}
	return "Невозможно выполнить операцию! Исправьте ошибки:\n" + strings.Join(lines, "\n"), rows.Err()
}

// splitOrder — новый заказ покупателя с теми же шапкой и номером клиента; строки АРМ неотмеченных ключей переносятся
// туда с номером и датой нового заказа и разблокируются (ОбновитьСсылкуЗПВРегистре).
func (s *Service) splitOrder(ctx context.Context, tx pgx.Tx, a Actor, order uuid.UUID, restKeys []string) (uuid.UUID, error) {
	number, err := nextNumber(ctx, tx, "doc.customer_order")
	if err != nil {
		return uuid.Nil, err
	}
	id := uuid.Must(uuid.NewV7())
	now := s.now()
	if _, err := tx.Exec(ctx, `insert into doc.customer_order (id, number, date, posted, deleted, counterparty_id, contract_id, organization_id, client_order_number,
		ship_date, author_id, total, operation, extra)
		select $2, $3, $4, false, false, counterparty_id, contract_id, organization_id, client_order_number, ship_date, $5, 0, operation, jsonb_build_object('split_from', id)
		from doc.customer_order where id = $1`, order, id, number, now, nullable(a.UserID)); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `update arm.line set customer_order_id = $2, internal_order_number = $3, order_date = $4,
		status = case when status = 'ЗаблокированоФоном' then case when operation = 'Продажа' then 'ВРаботе' else 'Черновик' end else status end,
		marked = false, marked_by_id = null, version = version + 1, updated_at = now()
		where customer_order_id = $1 and link_key = any($5) and not coalesce(marked, false) and not coalesce(deleted, false)`, order, id, number, now, restKeys); err != nil {
		return uuid.Nil, err
	}
	if err := syncOrderItems(ctx, tx, id); err != nil {
		return uuid.Nil, err
	}
	// заказ-остаток проводится, только если во всех строках есть номенклатура (РежимЗаписиОстаткаСплита)
	_, err = tx.Exec(ctx, `update doc.customer_order set posted = not exists (select 1 from doc.customer_order_item where doc_id = $1 and nomenclature_id is null) where id = $1`, id)
	return id, err
}

// saleLines — продажи заказа (не вычеркнутые).
func saleLines(ctx context.Context, tx pgx.Tx, order uuid.UUID) ([]line, error) {
	return selectLines(ctx, tx, "customer_order_id = $1 and operation = 'Продажа' and not coalesce(deleted, false) order by sort_order for update", order)
}

// rebuildOrderForPurchases — ОбработатьЗаказыПокупателей: заказ покупателя — продажи отмеченных ключей, остальные — в новый заказ.
func (s *Service) rebuildOrderForPurchases(ctx context.Context, tx pgx.Tx, a Actor, order uuid.UUID, keys []string) error {
	var cp *uuid.UUID
	_ = tx.QueryRow(ctx, "select counterparty_id from doc.customer_order where id = $1", order).Scan(&cp)
	if cp == nil {
		return fmt.Errorf("В заказе покупателя не заполнен контрагент")
	}
	sales, err := saleLines(ctx, tx, order)
	if err != nil {
		return err
	}
	var marked []line
	var rest []string
	for _, l := range sales {
		if contains(keys, l.LinkKey) {
			marked = append(marked, l)
		} else {
			rest = append(rest, l.LinkKey)
		}
	}
	if len(rest) > 0 {
		if _, err := s.splitOrder(ctx, tx, a, order, rest); err != nil {
			return err
		}
	}
	if err := rebuildOrderItems(ctx, tx, order, marked); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update doc.customer_order set posted = true, contract_id = coalesce(contract_id, $2), version = version + 1, updated_at = now() where id = $1`,
		order, contractOf(ctx, tx, *cp)); err != nil {
		return err
	}
	return outbox(ctx, tx, "customer_order", order)
}

func contractOf(ctx context.Context, tx pgx.Tx, cp uuid.UUID) *uuid.UUID {
	c, _ := findContract(ctx, tx, cp)
	return c
}

// orderPurchases — СоздатьЗаказыПоставщикамНаСервере + ОбновитьДанныеЗакупокВРегистре: закупки заблокированных ключей
// по поставщику, договору и заказу -> заказ поставщику, «Заказано»; продажа того же количества без партии — тоже.
func (s *Service) orderPurchases(ctx context.Context, tx pgx.Tx, a Actor, keys []string, original map[uuid.UUID]string) error {
	ps, err := selectLines(ctx, tx, "link_key = any($1) and operation = 'Закупка' and status = 'ЗаблокированоФоном' and not coalesce(deleted, false) order by sort_order for update", keys)
	if err != nil {
		return err
	}
	receipt := dayStart(s.now()).Add(4 * 24 * time.Hour)
	type head struct{ supplier, contract, order uuid.UUID }
	groups := map[head][]line{}
	var order []head
	for _, p := range ps {
		h := head{deref(p.Supplier), deref(p.Contract), deref(p.Order)}
		if _, ok := groups[h]; !ok {
			order = append(order, h)
		}
		groups[h] = append(groups[h], p)
	}
	for _, h := range order {
		list := groups[h]
		so, err := s.createSupplierOrder(ctx, tx, a, nullable(h.supplier), nullable(h.contract), nullable(h.order), list, receipt)
		if err != nil {
			return err
		}
		qty := map[string]float64{}
		for _, p := range list {
			set := merge(map[string]any{"supplier_order_id": so, "status": stOrdered}, unmark)
			set["supplier_order_date"] = dayStart(s.now())
			if err := updateLine(ctx, tx, p.ID, set); err != nil {
				return err
			}
			qty[p.LinkKey] = p.Quantity
		}
		sales, err := selectLines(ctx, tx, "link_key = any($1) and operation = 'Продажа' and status = 'ЗаблокированоФоном' and not coalesce(deleted, false) for update", keysOf(qty))
		if err != nil {
			return err
		}
		for _, sl := range sales {
			st, ok := original[sl.ID]
			if !ok {
				st = stInWork
			}
			set := merge(map[string]any{"supplier_order_id": so, "supplier_order_date": dayStart(s.now())}, unmark)
			if q, ok := qty[sl.LinkKey]; ok && q == sl.Quantity && sl.Batch == nil {
				set["status"] = stOrdered
				delete(qty, sl.LinkKey)
			} else {
				set["status"] = st
			}
			if err := updateLine(ctx, tx, sl.ID, set); err != nil {
				return err
			}
		}
	}
	return nil
}

func keysOf(m map[string]float64) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func deref(u *uuid.UUID) uuid.UUID {
	if u == nil {
		return uuid.Nil
	}
	return *u
}

// shipSales — ОбработатьЧистыеПродажиВФоне: заказ покупателя — отмеченные продажи (остальные — в новый заказ),
// проведение; расходная накладная по отмеченным; строки -> «Отгружено» с номером РН, неотмеченные — исходный статус.
func (s *Service) shipSales(ctx context.Context, tx pgx.Tx, a Actor, order uuid.UUID, keys []string, original map[uuid.UUID]string) error {
	sales, err := saleLines(ctx, tx, order)
	if err != nil {
		return err
	}
	var marked []line
	var rest []string
	for _, l := range sales {
		if l.Marked {
			marked = append(marked, l)
		} else {
			rest = append(rest, l.LinkKey)
		}
	}
	if len(marked) > 0 && len(rest) > 0 {
		if _, err := s.splitOrder(ctx, tx, a, order, rest); err != nil {
			return err
		}
	}
	if err := rebuildOrderItems(ctx, tx, order, marked); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "update doc.customer_order set posted = true, version = version + 1, updated_at = now() where id = $1", order); err != nil {
		return err
	}
	if err := outbox(ctx, tx, "customer_order", order); err != nil {
		return err
	}
	shipID, number, err := s.createShipment(ctx, tx, a, order, marked)
	if err != nil {
		return err
	}
	all, err := selectLines(ctx, tx, "customer_order_id = $1 and operation = 'Продажа' and not coalesce(deleted, false) and status in ('ЗаблокированоФоном', 'Собран') for update", order)
	if err != nil {
		return err
	}
	for _, l := range all {
		if l.Marked {
			set := merge(map[string]any{"shipment_doc_id": shipID, "shipment_number": number, "status": stShipped}, unmark)
			if l.ShipmentDate == nil {
				set["shipment_date"] = dayStart(s.now())
			}
			if err := updateLine(ctx, tx, l.ID, set); err != nil {
				return err
			}
			continue
		}
		st, ok := original[l.ID]
		if !ok {
			st = stInWork
		}
		if err := updateLine(ctx, tx, l.ID, merge(map[string]any{"status": st}, unmark)); err != nil {
			return err
		}
	}
	return nil
}
