// Package application — use-cases для workshop (G1–G9) и неопознанных позиций (M18/A1/K8).
package application

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"vitauto/backend/internal/domain"
)

// ——— Workshop (G1–G9) ———

// WorkOrderCreate — G1: создание заказ-наряда (ремонтная зона).
func (s *Service) WorkOrderCreate(ctx context.Context, a domain.Actor, carID string, customerID string, orderID string, lines []WorkOrderLine) (*WorkOrder, error) {
	if err := requireActor(a); err != nil {
		return nil, err
	}
	if len(lines) == 0 {
		return nil, fail(400, "bad_request", "lines: непустой массив", "lines")
	}

	var woID uuid.UUID
	var car, cust, order *uuid.UUID
	if carID != "" {
		id, err := parseID(carID)
		if err != nil {
			return nil, err
		}
		car = &id
	}
	if customerID != "" {
		id, err := parseID(customerID)
		if err != nil {
			return nil, err
		}
		cust = &id
	}
	if orderID != "" {
		id, err := parseID(orderID)
		if err != nil {
			return nil, err
		}
		order = &id
	}

	var num string
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		var err error
		num, err = nextDocNumber(ctx, tx, "doc.work_order")
		if err != nil {
			return err
		}
		woID = uuid.Must(uuid.NewV7())
		now := s.now()

		// Шапка
		_, err = tx.Exec(ctx, `insert into doc.work_order
			(id, number, date, car_id, customer_id, customer_order_id, warehouse_id, responsible_id, author_id, status)
			values ($1, $2, $3, $4, $5, $6, null, $7, $8, 'open')`,
			woID, num, now, car, cust, order, a.UserID, a.UserID)
		if err != nil {
			return err
		}

		var totalNH float64
		for _, l := range lines {
			nomID, err := parseID(l.NomenclatureID)
			if err != nil {
				return err
			}
			var lineID *uuid.UUID
			if l.LineID != "" {
				id, err := parseID(l.LineID)
				if err != nil {
					return err
				}
				lineID = &id
			}
			nh := l.NormHours
			if nh <= 0 {
				nh = 0
			}
			lid, err := uuid.NewV7()
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `insert into doc.work_order_line
				(id, work_order_id, line_id, nomenclature_id, quantity, norm_hours, comment)
				values ($1, $2, $3, $4, $5, $6, $7)`,
				lid, woID, lineID, nomID, l.Quantity, nh, l.Comment)
			if err != nil {
				return err
			}
			totalNH += nh
		}

		// Обновить нормо-часы
		_, err = tx.Exec(ctx, `update doc.work_order set total_norm_hours = $1, updated_at = now() where id = $2`, totalNH, woID)
		return err
	})
	return &WorkOrder{ID: woID, Number: num}, err
}

// WorkOrderRelease — G9: выдача авто (закрытие заказ-наряда).
func (s *Service) WorkOrderRelease(ctx context.Context, a domain.Actor, woID string) error {
	id, err := parseID(woID)
	if err != nil {
		return err
	}
	if err := requireActor(a); err != nil {
		return err
	}
	_, err = s.DB.Exec(ctx, `update doc.work_order
		set status = 'released', released_at = now(), updated_at = now()
		where id = $1 and status = 'open'`, id)
	return err
}

// WorkOrderList — список заказ-нарядов.
func (s *Service) WorkOrderList(ctx context.Context, a domain.Actor) ([]WorkOrder, error) {
	rows, err := s.DB.Query(ctx, `select id, number, date, status, total_norm_hours, released_at, created_at
		from doc.work_order where not deleted order by created_at desc limit 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkOrder
	for rows.Next() {
		var wo WorkOrder
		if err := rows.Scan(&wo.ID, &wo.Number, &wo.Date, &wo.Status, &wo.TotalNormHours, &wo.ReleasedAt, &wo.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, wo)
	}
	return out, nil
}

// WorkOrderDetail — деталь заказ-наряда.
func (s *Service) WorkOrderDetail(ctx context.Context, a domain.Actor, woID string) (map[string]any, error) {
	id, err := parseID(woID)
	if err != nil {
		return nil, err
	}
	row := s.DB.QueryRow(ctx, `select id, number, date, status, total_norm_hours, labor_sum, parts_sum, released_at, created_at, comment
		from doc.work_order where id = $1 and not deleted`, id)
	var wo WorkOrder
	if err := row.Scan(&wo.ID, &wo.Number, &wo.Date, &wo.Status, &wo.TotalNormHours, &wo.LaborSum, &wo.PartsSum,
		&wo.ReleasedAt, &wo.CreatedAt, &wo.Comment); err != nil {
		return nil, err
	}

	lines, err := s.DB.Query(ctx, `select wol.id, wol.line_id, wol.nomenclature_id, wol.quantity, wol.norm_hours,
			coalesce(wol.comment, ''), coalesce(n.name, ''), coalesce(wl.status, '')
			from doc.work_order_line wol
			left join ref.nomenclature n on n.id = wol.nomenclature_id
			left join arm.line wl on wl.id = wol.line_id
			where wol.work_order_id = $1 and not wol.deleted order by wol.created_at`, id)
	if err != nil {
		return nil, err
	}
	defer lines.Close()

	var lineItems []map[string]any
	for lines.Next() {
		var lid uuid.UUID
		var lineID, nomID uuid.NullUUID
		var qty, nh float64
		var comment, nomName, lineStatus string
		if err := lines.Scan(&lid, &lineID, &nomID, &qty, &nh, &comment, &nomName, &lineStatus); err != nil {
			return nil, err
		}
		item := map[string]any{
			"id":               lid,
			"nomenclatureName": nomName,
			"quantity":         qty,
			"normHours":        nh,
			"comment":          comment,
			"lineStatus":       lineStatus,
		}
		if lineID.Valid {
			item["lineId"] = lineID.UUID
		}
		if nomID.Valid {
			item["nomenclatureId"] = nomID.UUID
		}
		lineItems = append(lineItems, item)
	}

	return map[string]any{
		"id":          wo.ID,
		"number":      wo.Number,
		"date":        wo.Date.Format("2006-01-02"),
		"status":      wo.Status,
		"totalNormHours": wo.TotalNormHours,
		"laborSum": wo.LaborSum,
		"partsSum": wo.PartsSum,
		"lines": lineItems,
	}, nil
}

// WorkOrderLine — строка заказ-наряда.
type WorkOrderLine struct {
	NomenclatureID string  `json:"nomenclatureId"`
	LineID         string  `json:"lineId"`
	Quantity       float64 `json:"quantity"`
	NormHours      float64 `json:"normHours"`
	Comment        string  `json:"comment"`
}

// WorkOrder — модель заказ-наряда.
type WorkOrder struct {
	ID             uuid.UUID  `json:"id"`
	Number         string     `json:"number"`
	Date           time.Time  `json:"date"`
	Status         string     `json:"status"` // open, released
	TotalNormHours float64    `json:"totalNormHours"`
	LaborSum       float64    `json:"laborSum"`
	PartsSum       float64    `json:"partsSum"`
	ReleasedAt     *time.Time `json:"releasedAt,omitempty"`
	Comment        string     `json:"comment,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// ——— Unidentified Items (M18/A1/K8) ———

// UnidentifiedCreate — M18: создание неопознанной позиции.
func (s *Service) UnidentifiedCreate(ctx context.Context, a domain.Actor, lineID string, factName string, photoURLs []string) (*UnidentifiedItem, error) {
	if err := requireActor(a); err != nil {
		return nil, err
	}
	if factName == "" && lineID == "" {
		return nil, fail(400, "bad_request", "factName или lineID обязательны", "factName")
	}

	var line *uuid.UUID
	if lineID != "" {
		id, err := parseID(lineID)
		if err != nil {
			return nil, err
		}
		line = &id
	}

	var uiID uuid.UUID
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		uiID = uuid.Must(uuid.NewV7())
		pj, _ := json.Marshal(photoURLs)
		if pj == nil {
			pj = []byte("[]")
		}
		_, err := tx.Exec(ctx, `insert into doc.unidentified_item
			(id, line_id, fact_name, photo_urls, created_at)
			values ($1, $2, $3, $4, $5)`,
			uiID, line, factName, string(pj), s.now())
		return err
	})
	return &UnidentifiedItem{ID: uiID, Found: false}, err
}

// UnidentifiedLink — A1/A2: привязка неопознанной позиции к номенклатуре.
func (s *Service) UnidentifiedLink(ctx context.Context, a domain.Actor, uiID string, nomenclatureID string) error {
	id, err := parseID(uiID)
	if err != nil {
		return err
	}
	nomID, err := parseID(nomenclatureID)
	if err != nil {
		return err
	}
	if err := requireActor(a); err != nil {
		return err
	}

	_, err = s.DB.Exec(ctx, `update doc.unidentified_item
		set nomenclature_id = $1, resolved_by_id = $2, resolved_at = now(), found = false, updated_at = now()
		where id = $3 and not deleted`, nomID, a.UserID, id)
	return err
}

// UnidentifiedFound — K8: кладовщик нашёл позицию на складе (без привязки новой номенклатуры).
func (s *Service) UnidentifiedFound(ctx context.Context, a domain.Actor, uiID string) error {
	id, err := parseID(uiID)
	if err != nil {
		return err
	}
	if err := requireActor(a); err != nil {
		return err
	}

	_, err = s.DB.Exec(ctx, `update doc.unidentified_item
		set found = true, resolved_by_id = $1, resolved_at = now(), updated_at = now()
		where id = $2 and not deleted`, a.UserID, id)
	return err
}

// UnidentifiedList — список неопознанных позиций.
func (s *Service) UnidentifiedList(ctx context.Context, a domain.Actor) ([]UnidentifiedItem, error) {
	rows, err := s.DB.Query(ctx, `select id, line_id, fact_name, fact_article, photo_urls, nomenclature_id, found, created_at, resolved_at
		from doc.unidentified_item where not deleted order by created_at desc limit 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UnidentifiedItem
	for rows.Next() {
		var ui UnidentifiedItem
		var photoStr string
		if err := rows.Scan(&ui.ID, &ui.LineID, &ui.FactName, &ui.FactArticle, &photoStr,
			&ui.NomenclatureID, &ui.Found, &ui.CreatedAt, &ui.ResolvedAt); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(photoStr), &ui.PhotoURLs)
		out = append(out, ui)
	}
	return out, nil
}

// UnidentifiedDetail — деталь неопознанной позиции.
func (s *Service) UnidentifiedDetail(ctx context.Context, a domain.Actor, uiID string) (map[string]any, error) {
	id, err := parseID(uiID)
	if err != nil {
		return nil, err
	}
	row := s.DB.QueryRow(ctx, `select id, line_id, source, fact_name, fact_article, fact_qty, fact_unit,
		photo_urls, comment, nomenclature_id, found, resolved_by_id, resolved_at, created_at
		from doc.unidentified_item where id = $1 and not deleted`, id)
	var ui UnidentifiedItem
	var photoStr string
	if err := row.Scan(&ui.ID, &ui.LineID, &ui.Source, &ui.FactName, &ui.FactArticle,
		&ui.FactQty, &ui.FactUnit, &photoStr, &ui.Comment, &ui.NomenclatureID,
		&ui.Found, &ui.ResolvedBy, &ui.ResolvedAt, &ui.CreatedAt); err != nil {
		return nil, err
	}
	json.Unmarshal([]byte(photoStr), &ui.PhotoURLs)

	return map[string]any{
		"id":             ui.ID,
		"lineId":         ui.LineID,
		"source":         ui.Source,
		"factName":       ui.FactName,
		"factArticle":    ui.FactArticle,
		"factQty":        ui.FactQty,
		"factUnit":       ui.FactUnit,
		"photoUrls":      ui.PhotoURLs,
		"comment":        ui.Comment,
		"nomenclatureId": ui.NomenclatureID,
		"found":          ui.Found,
		"resolvedBy":     ui.ResolvedBy,
		"resolvedAt":     ui.ResolvedAt,
	}, nil
}

// UnidentifiedItem — модель неопознанной позиции.
type UnidentifiedItem struct {
	ID             uuid.UUID  `json:"id"`
	LineID         *uuid.UUID `json:"lineId,omitempty"`
	Source         string     `json:"source,omitempty"` // line, stock, workshop
	FactName       string     `json:"factName"`
	FactArticle    string     `json:"factArticle,omitempty"`
	FactQty        string     `json:"factQty,omitempty"`
	FactUnit       string     `json:"factUnit,omitempty"`
	PhotoURLs      []string   `json:"photoUrls"`
	Comment        string     `json:"comment,omitempty"`
	NomenclatureID *uuid.UUID `json:"nomenclatureId,omitempty"`
	ResolvedBy     *uuid.UUID `json:"resolvedById,omitempty"`
	ResolvedAt     *time.Time `json:"resolvedAt,omitempty"`
	Found          bool       `json:"found"`
	CreatedAt      time.Time  `json:"createdAt"`
}
