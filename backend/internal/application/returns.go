// Package application — use-cases для фич возврата (C1/C2, M16, K6).
// Соответствует DDD-агрегату ReturnRequest (docs/migration/ddd/02-tactical.md).
package application

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"vitauto/backend/internal/domain"
)

// ReturnCreate — M16: создание возврата (от клиента или поставщику).
// operation = "Продажа" → клиентский возврат, "Закупка" → возврат поставщику.
func (s *Service) ReturnCreate(ctx context.Context, a domain.Actor, op domain.Operation, orderID string, lines []ReturnLine) (*ReturnDoc, error) {
	if err := requireActor(a); err != nil {
		return nil, err
	}
	if op != domain.OpSale && op != domain.OpPurchase {
		return nil, fail(400, "bad_request", "operation: Продажа или Закупка", "operation")
	}
	if len(lines) == 0 {
		return nil, fail(400, "bad_request", "lines: непустой массив", "lines")
	}

	var order *uuid.UUID
	if orderID != "" {
		id, err := parseID(orderID)
		if err != nil {
			return nil, err
		}
		order = &id
	}

	var returnID uuid.UUID
	var docNum string
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		num, err := nextDocNumber(ctx, tx, "doc.return_order")
		if err != nil {
			return err
		}
		docNum = num
		returnID = uuid.Must(uuid.NewV7())
		now := s.now()

		// Шапка
		_, err = tx.Exec(ctx, `insert into doc.return_order
			(id, number, date, operation, customer_order_id, warehouse_id, total_sum, total_qty, comment, posted)
			values ($1, $2, $3, $4, $5, null, 0, 0, 'Создано из PWA', false)`,
			returnID, num, now, string(op), order)
		if err != nil {
			return err
		}

		var totalSum, totalQty float64
		for i, l := range lines {
			nomID, err := parseID(l.NomenclatureID)
			if err != nil {
				return err
			}
			qty := l.Quantity
			if qty <= 0 {
				qty = 1
			}
			cost := l.CostPrice
			if cost <= 0 {
				// подтянуть себестоимость из последней строки
				var cp float64
				if err := tx.QueryRow(ctx, `select coalesce(cost_price, 0) from arm.line
					where nomenclature_id = $1 and operation = $2 and not coalesce(deleted, false)
					order by sort_order desc limit 1`, nomID, string(op)).Scan(&cp); err != nil {
					cp = 0
				}
				cost = cp
			}
			sum := round2(qty * cost)
			lid, err := uuid.NewV7()
			if err != nil {
				return err
			}
			// sourceLineId необязателен: пустая строка — это NULL, а не uuid "".
			var src *uuid.UUID
			if l.SourceLineID != "" {
				sid, err := parseID(l.SourceLineID)
				if err != nil {
					return err
				}
				src = &sid
			}
			_, err = tx.Exec(ctx, `insert into doc.return_line
				(id, return_order_id, sort_order, nomenclature_id, quantity, cost_price, cost_sum, source_line_id, reason)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				lid, returnID, i+1, nomID, qty, cost, sum, src, l.Reason)
			if err != nil {
				return err
			}
			totalSum += sum
			totalQty += qty
		}

		// Обновить шапку с итогами
		_, err = tx.Exec(ctx, `update doc.return_order set total_sum = $1, total_qty = $2, updated_at = now() where id = $3`,
			totalSum, totalQty, returnID)
		return err
	})
	return &ReturnDoc{ID: returnID, Number: docNum, Operation: op}, err
}

// ReturnPost — проведение возврата (К6): движение склада + перевод строк в статус «Возврат».
func (s *Service) ReturnPost(ctx context.Context, a domain.Actor, returnID string) (map[string]any, error) {
	id, err := parseID(returnID)
	if err != nil {
		return nil, err
	}
	if err := requireActor(a); err != nil {
		return nil, err
	}

	var result map[string]any
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		// 1. Движения склада
		rows, err := tx.Query(ctx, `select rl.id, rl.nomenclature_id, rl.quantity, rl.cost_sum, rl.batch_id, rl.reason,
			lo.operation, lo.warehouse_id
			from doc.return_line rl join doc.return_order lo on lo.id = rl.return_order_id
			where rl.return_order_id = $1 and not rl.deleted`, id)
		if err != nil {
			return err
		}
		// Сначала вычитываем строки полностью: pgx не даёт выполнять запросы
		// на том же соединении, пока открыт курсор rows (иначе — "conn busy").
		type moveRow struct {
			nomID   uuid.UUID
			batchID *uuid.UUID
			whID    *uuid.UUID
			qty     float64
			amount  float64
			reason  string
			op      string
		}
		var buffered []moveRow
		for rows.Next() {
			var r moveRow
			var lineID uuid.UUID
			if err := rows.Scan(&lineID, &r.nomID, &r.qty, &r.amount, &r.batchID, &r.reason, &r.op, &r.whID); err != nil {
				rows.Close()
				return err
			}
			buffered = append(buffered, r)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		var moved, lines int
		for _, r := range buffered {
			// movement: stock.move — 0 = приход, 1 = расход
			// Возврат от клиента (Продажа) = приход на склад; возврат поставщику (Закупка) = расход со склада
			movement := 0 // приход
			if r.op == string(domain.OpPurchase) {
				movement = 1 // расход
			}
			content := fmt.Sprintf("Возврат: %s", r.reason)
			_, err := tx.Exec(ctx, `insert into stock.move
				(id, period, recorder_type, recorder_id, line_no, active, movement, warehouse_id, nomenclature_id, batch_id,
				 qty, amount, is_return, content, onec_key)
				values ($1, $2, 'return_order', $3, 0, true, $4, $5, $6, $7, $8, $9, true, $10, 'app:' || gen_random_uuid()::text)`,
				uuid.Must(uuid.NewV7()), s.now(), id, movement, r.whID, r.nomID, r.batchID, r.qty, r.amount, content)
			if err != nil {
				return err
			}
			moved++
		}
		if moved == 0 {
			return fail(409, "nothing_to_post", "Нет строк для проведения")
		}
		lines = moved

		// 2. Пометить проведение
		_, err = tx.Exec(ctx, `update doc.return_order set posted = true, post_by_id = $1, post_date = now(), updated_at = now() where id = $2`,
			a.UserID, id)
		if err != nil {
			return err
		}

		// 3. Перевести связанные строки arm.line в статус «Возврат»
		_, err = tx.Exec(ctx, `update arm.line set status = 'Возврат', version = version + 1, updated_at = now()
			where id in (select source_line_id from doc.return_line where return_order_id = $1 and source_line_id is not null)`,
			id)
		if err != nil {
			return err
		}

		result = map[string]any{"moved": moved, "lines": lines, "posted": true}
		return nil
	})
	return result, err
}

// ReturnCancel — отмена возврата.
func (s *Service) ReturnCancel(ctx context.Context, a domain.Actor, returnID string) error {
	id, err := parseID(returnID)
	if err != nil {
		return err
	}
	if err := requireActor(a); err != nil {
		return err
	}
	_, err = s.DB.Exec(ctx, `update doc.return_order set posted = false, comment = 'Отменено', updated_at = now() where id = $1`, id)
	return err
}

// ReturnLine — строка возврата (из тела запроса).
type ReturnLine struct {
	NomenclatureID string  `json:"nomenclatureId"`
	Quantity       float64 `json:"quantity"`
	CostPrice      float64 `json:"costPrice"`
	SourceLineID   string  `json:"sourceLineId,omitempty"`
	Reason         string  `json:"reason"`
}

// ReturnDoc — результат создания возврата / модель списка.
type ReturnDoc struct {
	ID        uuid.UUID        `json:"id"`
	Number    string           `json:"number"`
	Operation domain.Operation `json:"operation"`
	Date      time.Time        `json:"date"`
	TotalSum  float64          `json:"totalSum"`
	TotalQty  float64          `json:"totalQty"`
	Posted    bool             `json:"posted"`
	Comment   string           `json:"comment,omitempty"`
	CreatedAt time.Time        `json:"createdAt"`
}

// ReturnList — список возвратов.
func (s *Service) ReturnList(ctx context.Context, a domain.Actor) ([]ReturnDoc, error) {
	if err := requireActor(a); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(ctx, `select id, number, operation, date, total_sum, total_qty, posted, created_at
		from doc.return_order where not deleted order by created_at desc limit 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReturnDoc
	for rows.Next() {
		var r ReturnDoc
		var date, created time.Time
		if err := rows.Scan(&r.ID, &r.Number, &r.Operation, &date, &r.TotalSum, &r.TotalQty, &r.Posted, &created); err != nil {
			return nil, err
		}
		r.Date = date
		r.CreatedAt = created
		out = append(out, r)
	}
	return out, nil
}

// ReturnDetail — деталь возврата.
func (s *Service) ReturnDetail(ctx context.Context, a domain.Actor, returnID string) (map[string]any, error) {
	id, err := parseID(returnID)
	if err != nil {
		return nil, err
	}

	row := s.DB.QueryRow(ctx, `select id, number, operation, date, total_sum, total_qty, posted, comment, created_at
		from doc.return_order where id = $1 and not deleted`, id)
	var r ReturnDoc
	var date, created time.Time
	if err := row.Scan(&r.ID, &r.Number, &r.Operation, &date, &r.TotalSum, &r.TotalQty, &r.Posted, &r.Comment, &created); err != nil {
		return nil, err
	}
	r.Date = date
	r.CreatedAt = created

	lines, err := s.DB.Query(ctx, `select id, sort_order, nomenclature_id, quantity, cost_price, cost_sum, source_line_id, reason
		from doc.return_line where return_order_id = $1 and not deleted order by sort_order`, id)
	if err != nil {
		return nil, err
	}
	defer lines.Close()

	var lineItems []map[string]any
	for lines.Next() {
		var lid, nomID, srcLine uuid.UUID
		var sortO int
		var qty, cp, cs float64
		var reason string
		if err := lines.Scan(&lid, &sortO, &nomID, &qty, &cp, &cs, &srcLine, &reason); err != nil {
			return nil, err
		}
		item := map[string]any{
			"id":             lid,
			"sortOrder":      sortO,
			"nomenclatureId": nomID,
			"quantity":       qty,
			"costPrice":      cp,
			"costSum":        cs,
			"reason":         reason,
		}
		if srcLine != uuid.Nil {
			item["sourceLineId"] = srcLine
		}
		lineItems = append(lineItems, item)
	}

	return map[string]any{
		"id":     r.ID,
		"number": r.Number,
		"operation": string(r.Operation),
		"date": r.Date.Format("2006-01-02"),
		"totalSum": r.TotalSum,
		"totalQty": r.TotalQty,
		"posted": r.Posted,
		"comment": r.Comment,
		"lines": lineItems,
	}, nil
}
