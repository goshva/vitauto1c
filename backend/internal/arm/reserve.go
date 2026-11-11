package arm

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ReserveAvailable — POST /lines/reserve-available (ТЗ п. 11 «Частичный резерв и дозаказ»):
// по отмеченным продажам свободный остаток партий распределяется FIFO в резерв,
// недостающее количество уходит в черновую строку закупки «к дозаказу».
// Резерв может быть частичным: «Резерв» = доступное, «Частично заказано» = остаток под закупку.
func (s *Service) ReserveAvailable(ctx context.Context, a Actor, view, zoneID string) (map[string]any, error) {
	if view != "sales" {
		return nil, fail(400, "bad_request", "view: sales", "view")
	}
	if a.Role != "manager" && a.Role != "admin" {
		return nil, fail(403, "matrix_denied", "Резервирование доступного доступно менеджеру и администратору АРМ")
	}
	if err := requireUser(a); err != nil {
		return nil, err
	}
	var zone *uuid.UUID
	if zoneID != "" {
		z, err := parseID(zoneID)
		if err != nil {
			return nil, fail(400, "bad_request", "zoneId: нужен идентификатор зоны склада", "zoneId")
		}
		var exists bool
		if err := s.DB.QueryRow(ctx, "select exists(select 1 from ref.warehouse_zone where id = $1 and not deleted)", z).Scan(&exists); err != nil {
			return nil, err
		}
		if !exists {
			return nil, fail(404, "not_found", "Зона склада не найдена", "zoneId")
		}
		zone = &z
	}

	var total, reserved, shortage, purchases int
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		marked, err := selectLines(ctx, tx, `marked and marked_by_id = $1 and operation = 'Продажа' and not coalesce(deleted, false)
			and status in ('Черновик', 'ВРаботе', 'ЧастичноЗаказано') order by sort_order for update`, a.UserID)
		if err != nil {
			return err
		}
		total = len(marked)
		if total == 0 {
			return fail(409, "nothing_marked", "Нет отмеченных строк продаж в статусах «Черновик», «В работе», «Частично заказано»")
		}
		type pair struct{ nom, order uuid.UUID }
		groups := map[pair]bool{}
		var keys []string
		for i := range marked {
			l := &marked[i]
			if l.Nomenclature != nil {
				groups[pair{*l.Nomenclature, deref(l.Order)}] = true
			}
			if l.LinkKey != "" && !contains(keys, l.LinkKey) {
				keys = append(keys, l.LinkKey)
			}
		}
		// FIFO-пересчёт: свободный остаток -> строки с партиями, недостающее -> черновая закупка «к дозаказу».
		for p := range groups {
			if err := s.recalcStock(ctx, tx, a, p.nom, nullable(p.order)); err != nil {
				return err
			}
		}
		// После пересчёта строки могли разделиться по партиям — читаем все продажи отмеченных ключей.
		for _, key := range keys {
			sales, err := selectLines(ctx, tx, `link_key = $1 and operation = 'Продажа' and not coalesce(deleted, false) order by sort_order for update`, key)
			if err != nil {
				return err
			}
			for i := range sales {
				sl := &sales[i]
				if sl.MarkedBy != nil && *sl.MarkedBy != a.UserID {
					continue
				}
				set := map[string]any{}
				if sl.Batch != nil {
					set["reserve_qty"] = sl.Quantity
					set["status"] = stReserve
					// ФТ п. 10: снять резерв может только автор — запоминаем, кто поставил.
					set["reserved_by_id"] = a.UserID
					reserved++
				} else {
					set["reserve_qty"] = 0
					shortage++
				}
				if zone != nil {
					set["zone_id"] = *zone
				}
				for k, v := range unmark {
					set[k] = v
				}
				if err := updateLine(ctx, tx, sl.ID, set); err != nil {
					return err
				}
			}
		}
		return tx.QueryRow(ctx, `select count(*)::int from arm.line
			where link_key = any($1) and operation = 'Закупка' and status = 'Черновик'
			  and not coalesce(manual_edit, false) and not coalesce(deleted, false)`, keys).Scan(&purchases)
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"processed": total, "total": total, "reserved": reserved, "shortage": shortage, "purchases": purchases}, nil
}

// Unreserve — POST /lines/unreserve (ФТ п. 10 «Снять резерв»): по отмеченным продажам «Резервирование»
// снимает резерв только в тех строках, где автор резерва совпадает с текущим пользователем.
// Чужие строки пропускаются (в ответе — список). Строка без автора резерва считается общей и снимается.
// Статус возвращается в «В работе», reserve_qty обнуляется, reserved_by_id очищается.
func (s *Service) Unreserve(ctx context.Context, a Actor) (map[string]any, error) {
	if err := requireUser(a); err != nil {
		return nil, err
	}
	var done, total int
	var skipped []string
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		marked, err := selectLines(ctx, tx, "marked and marked_by_id = $1 and operation = $2 and not coalesce(deleted, false) and status = $3 order by sort_order for update",
			a.UserID, opSale, stReserve)
		if err != nil {
			return err
		}
		total = len(marked)
		if total == 0 {
			return fail(409, "nothing_marked", "Нет отмеченных строк продаж в статусе «Резервирование»")
		}
		for i := range marked {
			l := &marked[i]
			var reserver *uuid.UUID
			if err := tx.QueryRow(ctx, "select reserved_by_id from arm.line where id = $1", l.ID).Scan(&reserver); err != nil {
				return err
			}
			if reserver != nil && *reserver != a.UserID {
				name := l.FactName
				if name == "" {
					name = l.ID.String()
				}
				skipped = append(skipped, name+": резерв поставил другой пользователь")
				continue
			}
			set := merge(map[string]any{"status": stInWork, "reserve_qty": 0, "reserved_by_id": nil}, unmark)
			if err := updateLine(ctx, tx, l.ID, set); err != nil {
				return err
			}
			done++
		}
		if done == 0 {
			return fail(403, "not_author", "Снять резерв может только тот, кто его поставил: "+strings.Join(skipped, "; "))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	res := map[string]any{"processed": done, "total": total}
	if len(skipped) > 0 {
		res["message"] = "Пропущены: " + strings.Join(skipped, "; ")
	}
	return res, nil
}
