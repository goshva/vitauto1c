package arm

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SupplyOption — вариант поставки (ТЗ п. 12 «Выбор варианта поставки»): поставщик, цена, срок.
// Менеджер выбирает вариант в строке закупки, выбранный проставляется в строку (С1 supplier, С7 delivery_term).
type SupplyOption struct {
	ID           string  `json:"id"`
	SupplierID   string  `json:"supplierId"`
	SupplierName string  `json:"supplierName"`
	Price        float64 `json:"price"`
	DeliveryTerm string  `json:"deliveryTerm,omitempty"`
	Comment      string  `json:"comment,omitempty"`
	Source       string  `json:"source"` // saved — сохранённое предложение, history — подсказка из истории закупок
	Purchases    int     `json:"purchases,omitempty"`
	Selected     bool    `json:"selected"`
}

// SupplyOptionInput — тело POST /lines/{id}/supply-options.
type SupplyOptionInput struct {
	SupplierID   string  `json:"supplierId"`
	Price        float64 `json:"price"`
	DeliveryTerm string  `json:"deliveryTerm,omitempty"`
	Comment      string  `json:"comment,omitempty"`
}

// supplyOptionRoles — кому доступны варианты поставки (M2/M4: менеджер, снабжение, администратор).
var supplyOptionRoles = []string{"manager", "admin", "supply"}

// optionLine — номенклатура и текущий поставщик строки.
func (s *Service) optionLine(ctx context.Context, id uuid.UUID) (*uuid.UUID, *uuid.UUID, error) {
	var nom, sup *uuid.UUID
	err := s.DB.QueryRow(ctx, `select nomenclature_id, supplier_id from arm.line where id = $1 and not coalesce(deleted, false)`, id).Scan(&nom, &sup)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, fail(404, "not_found", "Строка не найдена")
	}
	return nom, sup, err
}

func parseTerm(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if len(raw) >= 10 {
		raw = raw[:10]
	}
	d, err := time.ParseInLocation("2006-01-02", raw, time.Local)
	if err != nil {
		return nil, fail(400, "bad_request", "deliveryTerm: ожидается дата ГГГГ-ММ-ДД", "deliveryTerm")
	}
	return &d, nil
}

func fmtTerm(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("2006-01-02")
}

// SupplyOptions — GET /lines/{id}/supply-options: предложения по номенклатуре строки —
// сохранённые (ref.supplier_offer) и подсказки из истории закупок (у кого и по какой цене брали).
func (s *Service) SupplyOptions(ctx context.Context, a Actor, lineID string) ([]SupplyOption, error) {
	if !contains(supplyOptionRoles, a.Role) {
		return nil, fail(403, "matrix_denied", "Варианты поставки доступны менеджеру, снабжению и администратору АРМ")
	}
	lid, err := parseID(lineID)
	if err != nil {
		return nil, err
	}
	nom, current, err := s.optionLine(ctx, lid)
	if err != nil {
		return nil, err
	}
	if nom == nil {
		return nil, fail(409, "no_nomenclature", "Сначала сопоставьте номенклатуру строки")
	}
	rows, err := s.DB.Query(ctx, `
		select o.id::text, o.supplier_id::text, coalesce(c.name, ''), coalesce(o.price, 0)::float8,
		       o.delivery_term, coalesce(o.comment, ''), 'saved'::text, 0
		  from ref.supplier_offer o
		  left join ref.counterparty c on c.id = o.supplier_id
		 where o.nomenclature_id = $1 and not o.deleted
		union all
		select '', h.supplier_id::text, coalesce(c.name, ''), h.price, h.delivery_term, '', 'history'::text, h.cnt
		  from (
		    select l.supplier_id, max(coalesce(l.sale_price, 0))::float8 as price,
		           max(l.delivery_term) as delivery_term, count(*)::int as cnt
		      from arm.line l
		     where l.nomenclature_id = $1 and l.operation = 'Закупка' and l.supplier_id is not null
		       and not coalesce(l.deleted, false)
		     group by l.supplier_id) h
		  left join ref.counterparty c on c.id = h.supplier_id
		 where not exists (select 1 from ref.supplier_offer o2
		                    where o2.nomenclature_id = $1 and o2.supplier_id = h.supplier_id and not o2.deleted)
		 order by 4, 3`, *nom)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SupplyOption
	for rows.Next() {
		var o SupplyOption
		var term *time.Time
		if err := rows.Scan(&o.ID, &o.SupplierID, &o.SupplierName, &o.Price, &term, &o.Comment, &o.Source, &o.Purchases); err != nil {
			return nil, err
		}
		o.DeliveryTerm = fmtTerm(term)
		if o.Source == "history" && o.ID == "" {
			o.ID = "history:" + o.SupplierID
		}
		o.Selected = current != nil && *current != uuid.Nil && *current == uuid.MustParse(o.SupplierID)
		out = append(out, o)
	}
	return out, rows.Err()
}

// SupplyOptionSave — POST /lines/{id}/supply-options: сохранить предложение поставщика
// (цена и срок) по номенклатуре строки; повторная запись обновляет цену и срок.
func (s *Service) SupplyOptionSave(ctx context.Context, a Actor, lineID string, in SupplyOptionInput) (*SupplyOption, error) {
	if !contains(supplyOptionRoles, a.Role) {
		return nil, fail(403, "matrix_denied", "Варианты поставки доступны менеджеру, снабжению и администратору АРМ")
	}
	lid, err := parseID(lineID)
	if err != nil {
		return nil, err
	}
	sup, err := parseID(strings.TrimSpace(in.SupplierID))
	if err != nil {
		return nil, fail(400, "bad_request", "supplierId: нужен идентификатор поставщика", "supplierId")
	}
	term, err := parseTerm(in.DeliveryTerm)
	if err != nil {
		return nil, err
	}
	nom, _, err := s.optionLine(ctx, lid)
	if err != nil {
		return nil, err
	}
	if nom == nil {
		return nil, fail(409, "no_nomenclature", "Сначала сопоставьте номенклатуру строки")
	}
	var outID uuid.UUID
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `select exists(select 1 from ref.counterparty where id = $1 and not deleted)`, sup).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fail(404, "not_found", "Поставщик не найден", "supplierId")
		}
		var id *uuid.UUID
		if err := tx.QueryRow(ctx, `select id from ref.supplier_offer where nomenclature_id = $1 and supplier_id = $2 and not deleted`, *nom, sup).Scan(&id); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if id != nil {
			outID = *id
			_, err := tx.Exec(ctx, `update ref.supplier_offer set price = $2, delivery_term = $3, comment = $4, updated_at = now()
				where id = $1`, outID, in.Price, term, strings.TrimSpace(in.Comment))
			return err
		}
		outID = uuid.Must(uuid.NewV7())
		_, err := tx.Exec(ctx, `insert into ref.supplier_offer (id, nomenclature_id, supplier_id, price, delivery_term, comment)
			values ($1, $2, $3, $4, $5, $6)`, outID, *nom, sup, in.Price, term, strings.TrimSpace(in.Comment))
		return err
	})
	if err != nil {
		return nil, err
	}
	options, err := s.SupplyOptions(ctx, a, lineID)
	if err != nil {
		return nil, err
	}
	for i := range options {
		if options[i].ID == outID.String() {
			return &options[i], nil
		}
	}
	return &SupplyOption{ID: outID.String(), SupplierID: sup.String(), Price: in.Price, DeliveryTerm: fmtTerm(term)}, nil
}

// ApplySupplyOption — POST /lines/{id}/supply-options/{optionId}/apply: выбранный вариант
// проставляется в строку (поставщик, цена, срок) и запоминается как предложение.
// optionId — идентификатор предложения или «history:<supplierId>».
func (s *Service) ApplySupplyOption(ctx context.Context, a Actor, lineID, optionID string) (map[string]any, error) {
	if !contains(supplyOptionRoles, a.Role) {
		return nil, fail(403, "matrix_denied", "Варианты поставки доступны менеджеру, снабжению и администратору АРМ")
	}
	lid, err := parseID(lineID)
	if err != nil {
		return nil, err
	}
	nom, _, err := s.optionLine(ctx, lid)
	if err != nil {
		return nil, err
	}
	if nom == nil {
		return nil, fail(409, "no_nomenclature", "Сначала сопоставьте номенклатуру строки")
	}

	var supplier uuid.UUID
	var price float64
	var term *time.Time
	var comment string
	if strings.HasPrefix(optionID, "history:") {
		supplier, err = parseID(strings.TrimPrefix(optionID, "history:"))
		if err != nil {
			return nil, fail(400, "bad_request", "optionId: нужен идентификатор варианта", "optionId")
		}
		if err := s.DB.QueryRow(ctx, `select max(coalesce(sale_price, 0))::float8, max(delivery_term)
			from arm.line where nomenclature_id = $1 and operation = 'Закупка' and supplier_id = $2 and not coalesce(deleted, false)`,
			*nom, supplier).Scan(&price, &term); err != nil {
			return nil, err
		}
	} else {
		oid, err := parseID(optionID)
		if err != nil {
			return nil, fail(400, "bad_request", "optionId: нужен идентификатор варианта", "optionId")
		}
		if err := s.DB.QueryRow(ctx, `select supplier_id, coalesce(price, 0)::float8, delivery_term, coalesce(comment, '')
			from ref.supplier_offer where id = $1 and nomenclature_id = $2 and not deleted`, oid, *nom).Scan(&supplier, &price, &term, &comment); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fail(404, "not_found", "Вариант поставки не найден", "optionId")
			}
			return nil, err
		}
	}

	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		if err := updateLine(ctx, tx, lid, map[string]any{
			"supplier_id":   supplier,
			"sale_price":    price,
			"delivery_term": term,
		}); err != nil {
			return err
		}
		// Запоминаем выбранный вариант, чтобы он был первым в списке в следующий раз.
		var id *uuid.UUID
		if err := tx.QueryRow(ctx, `select id from ref.supplier_offer where nomenclature_id = $1 and supplier_id = $2 and not deleted`, *nom, supplier).Scan(&id); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if id != nil {
			_, err := tx.Exec(ctx, `update ref.supplier_offer set price = $2, delivery_term = $3, updated_at = now() where id = $1`, *id, price, term)
			return err
		}
		_, err := tx.Exec(ctx, `insert into ref.supplier_offer (id, nomenclature_id, supplier_id, price, delivery_term, comment)
			values ($1, $2, $3, $4, $5, $6)`, uuid.Must(uuid.NewV7()), *nom, supplier, price, term, comment)
		return err
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"lineId": lid, "supplierId": supplier, "price": price, "deliveryTerm": fmtTerm(term)}, nil
}
