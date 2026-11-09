package arm

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// supplierOrderRoles — кто оформляет заказ поставщику из выбранных закупок: снабжение (полный доступ к заказу и ценам),
// менеджер по продажам (роль API manager) и администратор. Кладовщик заказ поставщику не оформляет.
var supplierOrderRoles = []string{"supply", "manager", "admin"}

// SupplierOrder — POST /sales/supplier-orders (ФТ v2, п. 3): по явно выбранным строкам закупок создаёт заказы
// поставщикам — по одному на поставщика, договор и заказ покупателя. Строки переходят в «Заказано», отметка снимается.
// Заказ покупателя не меняется: документ создаётся только по команде пользователя.
func (s *Service) SupplierOrder(ctx context.Context, a Actor, lineIDs []string) ([]DocRef, error) {
	if !contains(supplierOrderRoles, a.Role) {
		return nil, fail(403, "matrix_denied", "Заказ поставщику доступен ролям Снабжение, Менеджер и Администратор.")
	}
	if err := requireUser(a); err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(lineIDs))
	seen := map[uuid.UUID]bool{}
	for _, raw := range lineIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			return nil, fail(400, "bad_request", "lineIds: идентификаторы строк (uuid)", "lineIds")
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, fail(400, "bad_request", "lineIds: непустой массив", "lineIds")
	}

	var out []DocRef
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		ps, err := selectLines(ctx, tx, `id = any($1::uuid[]) and operation = 'Закупка' and marked and marked_by_id = $2
			and status in ('Черновик', 'ВРаботе') and supplier_order_id is null and not coalesce(deleted, false)
			order by sort_order for update`, ids, a.UserID)
		if err != nil {
			return err
		}
		if len(ps) != len(ids) {
			return fail(409, "nothing_marked", "Выберите отмеченные вами закупки в статусах «Черновик» или «В работе» без заказа поставщику")
		}
		for _, p := range ps {
			switch {
			case p.Supplier == nil:
				return fail(409, "validation", "Не указан поставщик для закупки", "supplier")
			case p.Nomenclature == nil:
				return fail(409, "validation", "Проверьте сопоставление (пустая номенклатура)", "nomenclature")
			case p.Quantity <= 0:
				return fail(409, "validation", "Нулевое количество", "quantity")
			}
		}

		type head struct{ supplier, contract, order uuid.UUID }
		groups := map[head][]line{}
		var heads []head
		for _, p := range ps {
			h := head{deref(p.Supplier), deref(p.Contract), deref(p.Order)}
			if _, ok := groups[h]; !ok {
				heads = append(heads, h)
			}
			groups[h] = append(groups[h], p)
		}

		receipt := dayStart(s.now()).Add(4 * 24 * time.Hour)
		for _, h := range heads {
			list := groups[h]
			so, err := s.createSupplierOrder(ctx, tx, a, nullable(h.supplier), nullable(h.contract), nullable(h.order), list, receipt)
			if err != nil {
				return err
			}
			ref := DocRef{ID: so, Kind: "supplier_order", Posted: true}
			var date time.Time
			if err := tx.QueryRow(ctx, "select number, date from doc.supplier_order where id = $1", so).Scan(&ref.Number, &date); err != nil {
				return err
			}
			ref.Date = date.Format("2006-01-02")
			out = append(out, ref)

			qty := map[string]float64{}
			for _, p := range list {
				if err := updateLine(ctx, tx, p.ID, merge(map[string]any{
					"supplier_order_id":   so,
					"supplier_order_date": dayStart(s.now()),
					"status":              stOrdered,
				}, unmark)); err != nil {
					return err
				}
				if p.LinkKey != "" {
					qty[p.LinkKey] = p.Quantity
				}
			}
			// продажа того же количества без партии, связанная с закупкой, считается заказанной вместе с ней
			if len(qty) == 0 {
				continue
			}
			sales, err := selectLines(ctx, tx, `link_key = any($1) and operation = 'Продажа' and status in ('Черновик', 'ВРаботе')
				and supplier_order_id is null and not coalesce(deleted, false) order by sort_order for update`, keysOf(qty))
			if err != nil {
				return err
			}
			for _, sl := range sales {
				if q, ok := qty[sl.LinkKey]; !ok || q != sl.Quantity || sl.Batch != nil {
					continue
				}
				if err := updateLine(ctx, tx, sl.ID, map[string]any{
					"supplier_order_id":   so,
					"supplier_order_date": dayStart(s.now()),
					"status":              stOrdered,
				}); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
