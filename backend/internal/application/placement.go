// placement.go — размещение по ячейкам склада (K2, ФФ9): привязка строки закупки к ref.storage_cell
// и автоматический переход «ПриходУется» → «НаСкладе» при размещении (K2→M8: уведомление менеджеру
// даёт триггер arm.line_status_notice).
package application

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"vitauto/backend/internal/domain"
)

// Cell — строка справочника ячеек (GET /cells) для CellPicker.
type Cell struct {
	ID          uuid.UUID  `json:"id"`
	WarehouseID uuid.UUID  `json:"warehouseId"`
	Code        string     `json:"code"`
	Zone        string     `json:"zone,omitempty"`
	ZoneID      *uuid.UUID `json:"zoneId,omitempty"`
	ZoneName    string     `json:"zoneName,omitempty"`
	Capacity    float64    `json:"capacity,omitempty"`
	Blocked     bool       `json:"blocked"`
	Free        int64      `json:"free"` // строк АРМ, закреплённых за ячейкой
}

// Cells — список ячеек; warehouseID пустой — все активные склады.
func (s *Service) Cells(ctx context.Context, a domain.Actor, warehouseID string) ([]Cell, error) {
	if err := requireActor(a); err != nil {
		return nil, err
	}
	var wh *uuid.UUID
	if warehouseID != "" {
		id, err := parseID(warehouseID)
		if err != nil {
			return nil, err
		}
		wh = &id
	}
	rows, err := s.DB.Query(ctx, `select c.id, c.warehouse_id, c.code, coalesce(c.zone, ''), c.zone_id, coalesce(z.name, ''),
			coalesce(c.capacity, 0), c.blocked,
			(select count(*) from arm.line l where l.cell_id = c.id and not l.deleted)
		from ref.storage_cell c left join ref.warehouse_zone z on z.id = c.zone_id
		where not c.deleted and ($1::uuid is null or c.warehouse_id = $1)
		order by coalesce(z.sort, 99), c.code limit 500`, wh)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Cell
	for rows.Next() {
		var c Cell
		if err := rows.Scan(&c.ID, &c.WarehouseID, &c.Code, &c.Zone, &c.ZoneID, &c.ZoneName, &c.Capacity, &c.Blocked, &c.Free); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// PlaceCell — K2: кладовщик привязывает ячейку к закупке в статусе «ПриходУется»;
// строка переходит в «НаСкладе» (канбан снабжения, цепочка acceptance → to_stock).
func (s *Service) PlaceCell(ctx context.Context, a domain.Actor, lineID, cellID string) (map[string]any, error) {
	if err := requireActor(a); err != nil {
		return nil, err
	}
	if a.Role != "storekeeper" && a.Role != "admin" {
		return nil, fail(403, "matrix_denied", "Размещение по ячейкам — роль кладовщика (K2)")
	}
	id, err := parseID(lineID)
	if err != nil {
		return nil, err
	}
	cell, err := parseID(cellID)
	if err != nil {
		return nil, err
	}

	out := map[string]any{}
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		var status, op string
		var warehouse *uuid.UUID
		err := tx.QueryRow(ctx, `select status, operation, warehouse_id from arm.line
			where id = $1 and not coalesce(deleted, false) for update`, id).Scan(&status, &op, &warehouse)
		if err != nil {
			if err == pgx.ErrNoRows {
				return fail(404, "not_found", "Строка не найдена")
			}
			return err
		}
		if op != string(domain.OpPurchase) {
			return fail(409, "bad_state", "Ячейку размещают только по закупкам")
		}
		var blocked bool
		var cellWh uuid.UUID
		if err := tx.QueryRow(ctx, `select warehouse_id, blocked from ref.storage_cell where id = $1 and not deleted`, cell).Scan(&cellWh, &blocked); err != nil {
			if err == pgx.ErrNoRows {
				return fail(404, "not_found", "Ячейка не найдена")
			}
			return err
		}
		if blocked {
			return fail(409, "cell_blocked", "Ячейка заблокирована")
		}
		if warehouse != nil && *warehouse != cellWh {
			return fail(409, "cell_warehouse", "Ячейка другого склада")
		}
		if status != string(domain.StatusAcceptance) {
			return fail(409, "bad_state", "Размещение возможно из статуса «ПриходУется», сейчас «"+status+"»")
		}
		if _, err := tx.Exec(ctx, `update arm.line
			set cell_id = $2, status = $3, version = version + 1, updated_at = now()
			where id = $1`, id, cell, string(domain.StatusToStock)); err != nil {
			return err
		}
		out["placed"] = true
		out["status"] = domain.StatusToStock.APICode()
		out["cellId"] = cell
		return nil
	})
	return out, err
}
