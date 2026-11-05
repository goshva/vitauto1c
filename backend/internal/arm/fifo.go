package arm

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// batchStock — свободный остаток партии для автоматического распределения.
type batchStock struct {
	Batch     *uuid.UUID
	Supplier  *uuid.UUID
	Available float64
	UnitCost  float64
}

// savedPurchase — поля черновой автозакупки, которые вводит пользователь и которые переживают пересчёт (ПоляЧерновойЗакупки).
type savedPurchase struct {
	ID                              uuid.UUID
	SortOrder                       float64
	Supplier, Contract, PaymentForm *uuid.UUID
	Price                           float64
	DeliveryTerm                    *time.Time
	Territory, Comment, Comment2    string
}

// recalcStock — пересчёт строк продаж номенклатуры по остаткам партий FIFO (ПолучитьОстаткиПоСтрокам /
// ПересчитатьОстаткиПоСтрокам АРМ 2.23). Блокировка номенклатуры — advisory lock на время транзакции.
func (s *Service) recalcStock(ctx context.Context, tx pgx.Tx, a Actor, nom uuid.UUID, order *uuid.UUID) error {
	if _, err := tx.Exec(ctx, "select pg_advisory_xact_lock(hashtext('fifo:' || $1::text))", nom); err != nil {
		return err
	}
	if err := collapseSales(ctx, tx, nom); err != nil {
		return err
	}
	saved, err := clearAutoPurchases(ctx, tx, nom)
	if err != nil {
		return err
	}
	stock, err := s.availableStock(ctx, tx, a, nom, order)
	if err != nil {
		return err
	}
	sales, err := selectLines(ctx, tx, `nomenclature_id = $1 and operation = 'Продажа' and not (status = any($2)) and not coalesce(deleted, false)
		and not coalesce(manual_batch, false) and not coalesce(manual_split_by_batch, false)
		and (not coalesce(marked, false) or marked_by_id = $3) order by sort_order for update`, nom, closedSale, a.UserID)
	if err != nil {
		return err
	}
	for i := range sales {
		sale := &sales[i]
		need := sale.Quantity
		first := true
		total := 0.0
		for _, b := range stock {
			total += b.Available
		}
		write := func(batch, supplier *uuid.UUID, qty, rest, cost, unit float64) error {
			set := map[string]any{"stock_qty": rest, "quantity": qty, "batch_id": batch, "supplier_id": supplier, "cost_sum": cost, "cost_price": unit}
			if first {
				first = false
				return updateLine(ctx, tx, sale.ID, set)
			}
			_, err := s.copyLine(ctx, tx, sale.ID, set) // СоздатьДопСтрокуПродажи
			return err
		}
		for k := range stock {
			b := &stock[k]
			if need <= 0 {
				break
			}
			if b.Available <= 0 {
				continue
			}
			take := min(need, b.Available)
			total -= take
			unit := round2(b.UnitCost)
			if err := write(b.Batch, b.Supplier, take, total, round2(take*unit), unit); err != nil {
				return err
			}
			need -= take
			b.Available -= take
		}
		if need > 0 {
			// часть без остатка (под закупку) сохраняет себестоимость единицы строки
			if err := write(nil, nil, need, 0, round2(need*sale.CostPrice), sale.CostPrice); err != nil {
				return err
			}
			if err := s.managePurchase(ctx, tx, sale, need, saved); err != nil {
				return err
			}
		}
	}
	return nil
}

// collapseSales — СхлопнутьСтрокиПродажПартии: строки продаж одного ключа и заказа сливаются в одну без партии.
func collapseSales(ctx context.Context, tx pgx.Tx, nom uuid.UUID) error {
	rows, err := tx.Query(ctx, `select link_key, customer_order_id, (array_agg(id order by onec_record_id desc))[1], array_agg(id),
		max(supplier_order_id::text)::uuid, max(receipt_id::text)::uuid, sum(coalesce(quantity, 0))::float8
		from arm.line where nomenclature_id = $1 and operation = 'Продажа' and not coalesce(manual_batch, false)
		  and not coalesce(manual_split_by_batch, false) and not coalesce(marked, false) and not (status = any($2)) and not coalesce(deleted, false)
		group by link_key, customer_order_id`, nom, closedSale)
	if err != nil {
		return err
	}
	type grp struct {
		keep   uuid.UUID
		all    []uuid.UUID
		so, rc *uuid.UUID
		qty    float64
	}
	var groups []grp
	for rows.Next() {
		var g grp
		var key *string
		var order *uuid.UUID
		if err := rows.Scan(&key, &order, &g.keep, &g.all, &g.so, &g.rc, &g.qty); err != nil {
			rows.Close()
			return err
		}
		groups = append(groups, g)
	}
	rows.Close()
	for _, g := range groups {
		for _, id := range g.all {
			if id != g.keep {
				if _, err := tx.Exec(ctx, "delete from arm.line where id = $1", id); err != nil {
					return err
				}
			}
		}
		if err := updateLine(ctx, tx, g.keep, map[string]any{"supplier_order_id": g.so, "receipt_id": g.rc, "quantity": g.qty, "batch_id": nil, "stock_qty": 0}); err != nil {
			return err
		}
	}
	return nil
}

// clearAutoPurchases — ОчиститьАвтоматическиеЗакупки: черновые автозакупки номенклатуры удаляются, их поля сохраняются.
func clearAutoPurchases(ctx context.Context, tx pgx.Tx, nom uuid.UUID) (map[string]savedPurchase, error) {
	rows, err := tx.Query(ctx, `select id, coalesce(link_key, ''), coalesce(sort_order, 0)::float8, supplier_id, contract_id, payment_form_id,
		coalesce(sale_price, 0)::float8, delivery_term, coalesce(supplier_ship_territory, ''), coalesce(comment, ''), coalesce(comment2, '')
		from arm.line where nomenclature_id = $1 and operation = 'Закупка' and status in ('Черновик', 'Собран') and not coalesce(manual_edit, false)
		order by sort_order`, nom)
	if err != nil {
		return nil, err
	}
	saved := map[string]savedPurchase{}
	var ids []uuid.UUID
	for rows.Next() {
		var p savedPurchase
		var key string
		if err := rows.Scan(&p.ID, &key, &p.SortOrder, &p.Supplier, &p.Contract, &p.PaymentForm, &p.Price, &p.DeliveryTerm, &p.Territory, &p.Comment, &p.Comment2); err != nil {
			rows.Close()
			return nil, err
		}
		if _, ok := saved[key]; !ok {
			saved[key] = p
		}
		ids = append(ids, p.ID)
	}
	rows.Close()
	for _, id := range ids {
		if _, err := tx.Exec(ctx, "delete from arm.line where id = $1", id); err != nil {
			return nil, err
		}
	}
	return saved, nil
}

// availableStock — партии номенклатуры: свободный остаток и остаток под заказ, минус ручные брони и чужие отметки;
// порядок — дата первого прихода партии (FIFO).
func (s *Service) availableStock(ctx context.Context, tx pgx.Tx, a Actor, nom uuid.UUID, order *uuid.UUID) ([]batchStock, error) {
	rows, err := tx.Query(ctx, `
		with bal as (
			select batch_id, sum(case when movement = 0 then qty else -qty end) as qty, sum(case when movement = 0 then amount else -amount end) as amount
			from stock.move
			where nomenclature_id = $1 and active and period < date_trunc('day', localtimestamp) + interval '1 day'
			  and (customer_order is null or ($2::uuid is not null and customer_order = $2))
			group by batch_id, customer_order),
		positive as (select batch_id, sum(qty) as qty, sum(amount) as amount from bal where qty > 0 group by batch_id),
		arrival as (select batch_id, min(period) as period from stock.move where nomenclature_id = $1 and movement = 0 group by batch_id),
		manual as (
			select batch_id, sum(coalesce(quantity, 0)) as qty from arm.line
			where nomenclature_id = $1 and not (status = any($3)) and not coalesce(deleted, false)
			  and (coalesce(manual_batch, false) or coalesce(manual_split_by_batch, false) or (coalesce(marked, false) and marked_by_id is distinct from $4))
			group by batch_id)
		select p.batch_id, b.supplier_id, (p.qty - coalesce(m.qty, 0))::float8, case when p.qty = 0 then 0 else (p.amount / p.qty)::float8 end
		from positive p left join ref.batch b on b.id = p.batch_id left join manual m on m.batch_id is not distinct from p.batch_id
		left join arrival r on r.batch_id is not distinct from p.batch_id
		where p.qty - coalesce(m.qty, 0) > 0
		order by coalesce(r.period, '3999-12-31'::timestamp)`, nom, order, closedSale, a.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []batchStock
	for rows.Next() {
		var b batchStock
		if err := rows.Scan(&b.Batch, &b.Supplier, &b.Available, &b.UnitCost); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// managePurchase — УправлятьСтрокойЗакупки: закупка на недостающее количество продажи. Ручные закупки и уже
// заказанные (заказ поставщику или статус дальше «Черновик») уменьшают потребность; черновая — одна на ключ.
func (s *Service) managePurchase(ctx context.Context, tx pgx.Tx, sale *line, need float64, saved map[string]savedPurchase) error {
	net := need
	var manual float64
	if err := tx.QueryRow(ctx, `select coalesce(sum(quantity), 0)::float8 from arm.line where nomenclature_id is not distinct from $1
		and operation = 'Закупка' and coalesce(manual_edit, false) and not coalesce(deleted, false)
		and customer_order_id is not distinct from $2 and link_key = $3`, sale.Nomenclature, sale.Order, sale.LinkKey).Scan(&manual); err != nil {
		return err
	}
	net -= manual
	if net <= 0 {
		return nil
	}
	ps, err := selectLines(ctx, tx, "link_key = $1 and operation = 'Закупка' and not coalesce(manual_edit, false) and not coalesce(deleted, false) order by sort_order for update", sale.LinkKey)
	if err != nil {
		return err
	}
	var draft *line
	for i := range ps {
		if ps[i].SupplierOrder != nil || ps[i].Status != stDraft {
			net -= ps[i].Quantity
		} else if draft == nil {
			draft = &ps[i]
		}
	}
	if net <= 0 {
		if draft != nil {
			_, err := tx.Exec(ctx, "delete from arm.line where id = $1", draft.ID)
			return err
		}
		return nil
	}
	if draft != nil {
		return updateLine(ctx, tx, draft.ID, map[string]any{"quantity": net})
	}
	prio, err := priority(ctx, tx, sale.Nomenclature)
	if err != nil {
		return err
	}
	set := map[string]any{"contract_id": nil, "operation": opPurchase, "status": stDraft, "supplier_order_id": nil, "receipt_id": nil,
		"sort_order": prio + 0.1, "sale_price": 0, "quantity": net, "marked": false, "marked_by_id": nil, "manual_edit": false,
		"batch_id": nil, "stock_qty": 0}
	if p, ok := saved[sale.LinkKey]; ok {
		set["id"], set["onec_record_id"] = p.ID, p.ID.String()
		set["sort_order"], set["supplier_id"], set["contract_id"], set["sale_price"] = p.SortOrder, p.Supplier, p.Contract, p.Price
		set["payment_form_id"], set["delivery_term"], set["supplier_ship_territory"] = p.PaymentForm, p.DeliveryTerm, p.Territory
		set["comment"], set["comment2"] = p.Comment, p.Comment2
	}
	_, err = s.copyLine(ctx, tx, sale.ID, set)
	return err
}

// syncOrderItems — СинхронизироватьЗапасыЗаказаСАРМ: строки заказа покупателя ↔ невычеркнутые продажи АРМ.
func syncOrderItems(ctx context.Context, tx pgx.Tx, order uuid.UUID) error {
	if _, err := tx.Exec(ctx, `delete from doc.customer_order_item i where i.doc_id = $1 and i.arm_link_key is not null
		and not exists (select 1 from arm.line l where l.customer_order_id = $1 and l.link_key = i.arm_link_key and l.operation = 'Продажа' and not coalesce(l.deleted, false))`, order); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		with need as (
			select l.link_key, max(l.nomenclature_id::text)::uuid as nom, sum(coalesce(l.quantity, 0)) as qty, max(coalesce(l.sale_price, 0)) as price,
			       max(l.fact_name) as fname, max(l.fact_qty) as fqty, max(l.fact_article) as fart, max(l.vehicle_plate) as plate,
			       max(l.urgency) as urg, max(l.territory) as terr, max(l.client_order_number) as cno, min(l.sort_order) as ord
			from arm.line l where l.customer_order_id = $1 and l.operation = 'Продажа' and not coalesce(l.deleted, false)
			  and not exists (select 1 from doc.customer_order_item i where i.doc_id = $1 and i.arm_link_key = l.link_key)
			group by l.link_key),
		base as (select coalesce(max(line_no), 0) as n from doc.customer_order_item where doc_id = $1)
		insert into doc.customer_order_item (id, doc_id, line_no, arm_link_key, nomenclature_type, nomenclature_id, unit_type, unit_id, qty, price, amount, total,
			client_name, client_qty, client_article, client_plate, client_urgency, client_territory, client_order_no)
		select uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', $1::text || ':' || (base.n + row_number() over (order by need.ord))::text), $1,
			base.n + row_number() over (order by need.ord), need.link_key, case when need.nom is null then null else 'ref.nomenclature' end, need.nom,
			'ref.unit', (select unit_id from ref.nomenclature where id = need.nom), need.qty, need.price, round(need.qty * need.price, 2), round(need.qty * need.price, 2),
			need.fname, need.fqty, need.fart, need.plate, need.urg, need.terr, need.cno
		from need, base`, order)
	if err != nil {
		return err
	}
	return refreshOrderTotals(ctx, tx, order)
}

// refreshOrderTotals — строки заказа по продажам АРМ (количество, цена, сумма) и итог документа.
func refreshOrderTotals(ctx context.Context, tx pgx.Tx, order uuid.UUID) error {
	if _, err := tx.Exec(ctx, `update doc.customer_order_item i set qty = s.qty, price = s.price, amount = round(s.qty * s.price, 2), total = round(s.qty * s.price, 2),
			nomenclature_id = coalesce(s.nom, i.nomenclature_id), version = i.version + 1, updated_at = now()
		from (select link_key, sum(coalesce(quantity, 0)) as qty, max(coalesce(sale_price, 0)) as price, max(nomenclature_id::text)::uuid as nom
		      from arm.line where customer_order_id = $1 and operation = 'Продажа' and not coalesce(deleted, false) group by link_key) s
		where i.doc_id = $1 and i.arm_link_key = s.link_key`, order); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `update doc.customer_order set total = (select coalesce(sum(total), 0) from doc.customer_order_item where doc_id = $1),
		version = version + 1, updated_at = now() where id = $1`, order)
	return err
}
