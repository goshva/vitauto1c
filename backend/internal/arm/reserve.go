package arm

import (
	"context"

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
	if err := requireUser(a); err != nil {
		return nil, err
	}
	if a.Role != "manager" && a.Role != "admin" {
		return nil, fail(403, "matrix_denied", "Резервирование доступного доступно менеджеру и администратору АРМ")
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
