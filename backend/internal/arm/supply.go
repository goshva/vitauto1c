package arm

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Supply — POST /supply/status, канбан снабжения (M7, P2, K1, K2, M9, K3): статус отмеченных закупок по цепочке
// Заказано → Оплачено → В пути → Приходуется → На складе → Комплектуется → Собран (ИзменитьСтатусыВРегистреСнабжения);
// связанная продажа того же количества без партии идёт следом; на «Собран» — приходная накладная и пересчёт склада.
func (s *Service) Supply(ctx context.Context, a Actor, status string, partial bool, receiptDate string) (map[string]any, error) {
	if !contains(SupplyRoles, a.Role) {
		return nil, fail(403, "matrix_denied", "Действие на форме снабжения доступно ролям Менеджер, Снабжение, Кладовщик и Администратор.")
	}
	chain, ok := SupplyStatus[status]
	if !ok {
		return nil, fail(400, "bad_request", "status: paid, in_transit, acceptance, to_stock, assembly, assembled", "status")
	}
	if err := requireUser(a); err != nil {
		return nil, err
	}
	target, prev := chain[0], chain[1]
	var processed, total int
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		ps, err := selectLines(ctx, tx, "marked and marked_by_id = $1 and operation = 'Закупка' and not coalesce(deleted, false) order by sort_order for update", a.UserID)
		if err != nil {
			return err
		}
		total = len(ps)
		if total == 0 {
			return fail(409, "nothing_marked", "Нет отмеченных закупок")
		}
		ids := make([]uuid.UUID, len(ps))
		for i := range ps {
			ids[i] = ps[i].ID
		}
		var receipt *time.Time
		if status == "assembled" {
			var partialReceipt bool
			_ = tx.QueryRow(ctx, `select exists(select 1 from arm.line t where t.supplier_order_id in (select supplier_order_id from arm.line where id = any($1))
				and not (t.id = any($1)) and not coalesce(t.deleted, false) and t.operation = 'Закупка'
				and t.status in ('Оплачено', 'ТоварВПути', 'Приходуется', 'НаСкладе', 'Комплектуется'))`, ids).Scan(&partialReceipt)
			if partialReceipt {
				if !partial {
					return fail(409, "need_split", "Частичный приход по заказу поставщику: повторите с partialReceipt=true и receiptDate")
				}
				d, err := time.ParseInLocation("2006-01-02", receiptDate, time.Local)
				if err != nil {
					return fail(400, "bad_request", "При частичном приходе нужна receiptDate", "receiptDate")
				}
				receipt = &d
			}
		}
		bySupplierOrder := map[uuid.UUID][]line{}
		var soOrder []uuid.UUID
		synced := map[uuid.UUID]map[string]float64{} // заказ покупателя -> ключ -> количество закупки
		for i := range ps {
			p := &ps[i]
			if p.Status != prev {
				continue
			}
			if err := updateLine(ctx, tx, p.ID, merge(s.statusSet(p, target), unmark)); err != nil {
				return err
			}
			processed++
			o := deref(p.Order)
			if synced[o] == nil {
				synced[o] = map[string]float64{}
			}
			synced[o][p.LinkKey] = p.Quantity
			if target == stAssembled && p.SupplierOrder != nil {
				if _, ok := bySupplierOrder[*p.SupplierOrder]; !ok {
					soOrder = append(soOrder, *p.SupplierOrder)
				}
				bySupplierOrder[*p.SupplierOrder] = append(bySupplierOrder[*p.SupplierOrder], *p)
			}
		}
		// продажа идёт за закупкой: то же количество, без партии
		for o, keys := range synced {
			sales, err := selectLines(ctx, tx, "customer_order_id is not distinct from $1 and operation = 'Продажа' and not coalesce(deleted, false) and link_key = any($2) for update",
				nullable(o), keysOf(keys))
			if err != nil {
				return err
			}
			for i := range sales {
				sl := &sales[i]
				if q, ok := keys[sl.LinkKey]; ok && q == sl.Quantity && sl.Batch == nil {
					if err := updateLine(ctx, tx, sl.ID, merge(s.statusSet(sl, target), unmark)); err != nil {
						return err
					}
					delete(keys, sl.LinkKey)
				}
			}
		}
		if len(soOrder) == 0 {
			return nil
		}
		type pair struct{ nom, order uuid.UUID }
		recalc := map[pair]bool{}
		for _, so := range soOrder {
			list := bySupplierOrder[so]
			rc, err := s.createReceipt(ctx, tx, a, so, list)
			if err != nil {
				return fmt.Errorf("Сбой базы данных: %w", err)
			}
			for _, p := range list {
				set := map[string]any{"receipt_id": rc}
				if receipt != nil {
					set["receipt_date"] = *receipt
				}
				if err := updateLine(ctx, tx, p.ID, set); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `update arm.line set receipt_id = $1, version = version + 1, updated_at = now()
					where link_key = $2 and operation = 'Продажа' and not coalesce(deleted, false) and batch_id is null and quantity = $3`, rc, p.LinkKey, p.Quantity); err != nil {
					return err
				}
				if p.Nomenclature != nil {
					recalc[pair{*p.Nomenclature, deref(p.Order)}] = true
				}
			}
		}
		for p := range recalc {
			if err := s.recalcStock(ctx, tx, a, p.nom, nullable(p.order)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"processed": processed, "total": total}, nil
}
