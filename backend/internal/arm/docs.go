package arm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"vitauto/backend/internal/onec"
)

// DocRef — ссылка на документ в ответах API.
type DocRef struct {
	ID     uuid.UUID `json:"id"`
	Kind   string    `json:"kind"`
	Number string    `json:"number"`
	Date   string    `json:"date"`
	Posted bool      `json:"posted"`
}

var docTables = map[string]string{"customer_order": "doc.customer_order", "supplier_order": "doc.supplier_order", "receipt": "doc.receipt", "shipment": "doc.shipment"}
var docItems = map[string]string{"customer_order": "doc.customer_order_item", "supplier_order": "doc.supplier_order_item", "receipt": "doc.receipt_item", "shipment": "doc.shipment_item"}

// outbox — документ в очередь бухгалтерии (1С ведёт учёт и отчётность, раздел 14 плана; отправка — этап 9).
func outbox(ctx context.Context, tx pgx.Tx, entity string, id uuid.UUID) error {
	_, err := tx.Exec(ctx, "insert into integration.outbox (entity, entity_id, payload) values ($1, $2, jsonb_build_object('kind', $1::text))", entity, id)
	return err
}

// mainWarehouse — основной склад (ref.warehouse.is_main).
func mainWarehouse(ctx context.Context, tx pgx.Tx) (*uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, "select id from ref.warehouse where is_main").Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &id, err
}

func organization(ctx context.Context, tx pgx.Tx) *uuid.UUID {
	var id uuid.UUID
	if err := tx.QueryRow(ctx, "select id from ref.organization where not deleted order by code limit 1").Scan(&id); err != nil {
		return nil
	}
	return &id
}

// ImportRow — строка листа покупателя (POST /sales/imports).
type ImportRow struct {
	ClientNumber string `json:"clientNumber"`
	Urgency      string `json:"urgency"`
	Plate        string `json:"plate"`
	Territory    string `json:"territory"`
	Article      string `json:"article"`
	Name         string `json:"name"`
	Quantity     string `json:"quantity"`
}

// CreateOrder — новый заказ покупателя (команда СоздатьЗаказ): шапка, строки листа клиента, строки АРМ «В работе»
// (ОбновитьДанныеПоОбъекту: ИдентификаторЗаписи = КлючСвязиСтрок).
func (s *Service) CreateOrder(ctx context.Context, a Actor, customerID, contractID, clientNumber, date string, rows []ImportRow) (*DocRef, error) {
	cust, err := uuid.Parse(customerID)
	if err != nil {
		return nil, fail(400, "bad_request", "Заказчик не указан", "customerId")
	}
	var ref DocRef
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		var ok bool
		_ = tx.QueryRow(ctx, "select exists(select 1 from ref.counterparty where id = $1)", cust).Scan(&ok)
		if !ok {
			return fail(400, "bad_request", "Заказчик не найден", "customerId")
		}
		var contract *uuid.UUID
		if contractID != "" {
			c, err := uuid.Parse(contractID)
			if err != nil {
				return fail(400, "bad_request", "contractId: UUID", "contractId")
			}
			var owner *uuid.UUID
			_ = tx.QueryRow(ctx, "select counterparty_id from ref.contract where id = $1", c).Scan(&owner)
			if owner == nil || *owner != cust {
				return fail(409, "contract_owner", "Договор не принадлежит заказчику", "contractId")
			}
			contract = &c
		} else if contract, err = findContract(ctx, tx, cust); err != nil {
			return err
		}
		d := s.now()
		if date != "" {
			if t, err := time.ParseInLocation("2006-01-02", date, time.Local); err == nil {
				d = t
			}
		}
		number, err := nextNumber(ctx, tx, "doc.customer_order")
		if err != nil {
			return err
		}
		id := uuid.Must(uuid.NewV7())
		if _, err := tx.Exec(ctx, `insert into doc.customer_order (id, number, date, posted, deleted, counterparty_id, contract_id, organization_id,
			client_order_number, author_id, total, operation) values ($1, $2, $3, false, false, $4, $5, $6, $7, $8, 0, 'ЗаказНаПродажу')`,
			id, number, d, cust, contract, organization(ctx, tx), clientNumber, nullable(a.UserID)); err != nil {
			return err
		}
		var order float64
		_ = tx.QueryRow(ctx, "select coalesce(max(sort_order), 0)::float8 from arm.line").Scan(&order)
		n := 0
		for _, r := range rows {
			name, art := strings.TrimSpace(r.Name), strings.TrimSpace(r.Article)
			if name == "" && art == "" {
				continue
			}
			n++
			key := uuid.New()
			cno := r.ClientNumber
			if cno == "" {
				cno = clientNumber
			}
			if _, err := tx.Exec(ctx, `insert into doc.customer_order_item (id, doc_id, line_no, arm_link_key, client_order_no, client_urgency, client_plate,
				client_territory, client_article, client_name, client_qty, qty, price, amount, total)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0, 0, 0)`,
				onec.TabularID(id, int64(n)), id, n, key.String(), cno, r.Urgency, r.Plate, r.Territory, art, name, r.Quantity); err != nil {
				return err
			}
			order++
			if _, err := insertLine(ctx, tx, map[string]any{"id": key, "link_key": key.String(), "operation": opSale, "status": stInWork,
				"customer_order_id": id, "customer_id": cust, "contract_id": contract, "client_order_number": clientNumber, "order_date": d,
				"internal_order_number": number, "fact_name": name, "fact_article": art, "fact_qty": r.Quantity, "vehicle_plate": r.Plate,
				"urgency": r.Urgency, "territory": r.Territory, "sort_order": order, "deleted": false, "marked": false, "manual_edit": false}); err != nil {
				return err
			}
		}
		if rows != nil && n == 0 {
			return fail(400, "bad_request", "В листе нет строк с наименованием или артикулом")
		}
		ref = DocRef{ID: id, Kind: "customer_order", Number: number, Date: d.Format("2006-01-02")}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &ref, nil
}

func nullable(u uuid.UUID) *uuid.UUID {
	if u == uuid.Nil {
		return nil
	}
	return &u
}

// PostOrder — ПровестиЗаказ (M15): отмеченные «Подготовлено» с номенклатурой, количеством и ценой -> строки заказа,
// проведение; строки АРМ -> «Завершено».
func (s *Service) PostOrder(ctx context.Context, a Actor, orderID string) (map[string]any, error) {
	if err := requireUser(a); err != nil {
		return nil, err
	}
	oid, err := uuid.Parse(orderID)
	if err != nil {
		return nil, fail(404, "not_found", "Заказ покупателя не найден")
	}
	var n int
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		var exists bool
		_ = tx.QueryRow(ctx, "select exists(select 1 from doc.customer_order where id = $1)", oid).Scan(&exists)
		if !exists {
			return fail(404, "not_found", "Заказ покупателя не найден")
		}
		ls, err := selectLines(ctx, tx, `customer_order_id = $1 and marked and marked_by_id = $2 and operation = 'Продажа' and nomenclature_id is not null
			and coalesce(quantity, 0) <> 0 and coalesce(sale_price, 0) <> 0 and status = 'Подготовлено' and not coalesce(deleted, false) for update`, oid, a.UserID)
		if err != nil {
			return err
		}
		if len(ls) == 0 {
			return fail(409, "nothing_marked", "Нет отмеченных строк заказа в статусе «Подготовлено» с номенклатурой, количеством и ценой")
		}
		if ls[0].Customer == nil {
			return fail(409, "contract_owner", "В заказе не заполнен покупатель")
		}
		contract := ls[0].Contract
		if contract == nil {
			if contract, err = findContract(ctx, tx, *ls[0].Customer); err != nil {
				return err
			}
		}
		if contract == nil {
			return fail(409, "contract_owner", "В заказе не заполнен договор")
		}
		if err := rebuildOrderItems(ctx, tx, oid, ls); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "update doc.customer_order set counterparty_id = $2, contract_id = $3, posted = true, version = version + 1, updated_at = now() where id = $1",
			oid, ls[0].Customer, contract); err != nil {
			return err
		}
		for i := range ls {
			if err := updateLine(ctx, tx, ls[i].ID, merge(map[string]any{"status": stFinished}, unmark)); err != nil {
				return err
			}
		}
		n = len(ls)
		return outbox(ctx, tx, "customer_order", oid)
	})
	return map[string]any{"processed": n, "total": n}, err
}

// rebuildOrderItems — табличная часть заказа покупателя = переданные строки продаж (Сумма = Количество × Цена).
func rebuildOrderItems(ctx context.Context, tx pgx.Tx, order uuid.UUID, ls []line) error {
	if _, err := tx.Exec(ctx, "delete from doc.customer_order_item where doc_id = $1", order); err != nil {
		return err
	}
	for i, l := range ls {
		amount := round2(l.Quantity * l.SalePrice)
		if _, err := tx.Exec(ctx, `insert into doc.customer_order_item (id, doc_id, line_no, arm_link_key, nomenclature_type, nomenclature_id, unit_type, unit_id,
			batch_id, qty, price, amount, total, client_name, client_order_no)
			values ($1, $2, $3, $4, 'ref.nomenclature', $5, 'ref.unit', (select unit_id from ref.nomenclature where id = $5), $6, $7, $8, $9, $9, $10, $11)`,
			onec.TabularID(order, int64(i+1)), order, i+1, l.LinkKey, l.Nomenclature, l.Batch, l.Quantity, l.SalePrice, amount, l.FactName, l.ClientOrderNumber); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, "update doc.customer_order set total = (select coalesce(sum(total), 0) from doc.customer_order_item where doc_id = $1), version = version + 1, updated_at = now() where id = $1", order)
	return err
}

// DeleteOrder — DELETE /sales/customer-orders/{id}: только без заказов поставщику и строк дальше «В работе».
func (s *Service) DeleteOrder(ctx context.Context, a Actor, orderID string) error {
	oid, err := uuid.Parse(orderID)
	if err != nil {
		return fail(404, "not_found", "Заказ покупателя не найден")
	}
	return s.inTx(ctx, a, func(tx pgx.Tx) error {
		var so bool
		_ = tx.QueryRow(ctx, "select exists(select 1 from doc.supplier_order where customer_order_id = $1 and not deleted)", oid).Scan(&so)
		if so {
			return fail(409, "unfinished_purchase", "По заказу есть заказ поставщику — удалить нельзя")
		}
		var busy bool
		_ = tx.QueryRow(ctx, "select exists(select 1 from arm.line where customer_order_id = $1 and not coalesce(deleted, false) and status not in ('Черновик', 'ВРаботе'))", oid).Scan(&busy)
		if busy {
			return fail(409, "row_locked", "В заказе есть строки дальше статуса «В работе» — удалить нельзя")
		}
		if _, err := tx.Exec(ctx, "update doc.customer_order set deleted = true, version = version + 1, updated_at = now() where id = $1", oid); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "delete from arm.line where customer_order_id = $1", oid)
		return err
	})
}

// DocumentCard — GET /documents/{kind}/{id}: шапка и строки документа.
func (s *Service) DocumentCard(ctx context.Context, kind, id string) (map[string]any, error) {
	table, ok := docTables[kind]
	if !ok {
		return nil, fail(404, "not_found", "Вид документа: customer_order, supplier_order, receipt, shipment")
	}
	did, err := uuid.Parse(id)
	if err != nil {
		return nil, fail(404, "not_found", "Документ не найден")
	}
	var card []byte
	err = s.DB.QueryRow(ctx, fmt.Sprintf(`select jsonb_build_object('id', d.id, 'kind', $2::text, 'number', d.number, 'date', to_char(d.date, 'YYYY-MM-DD'),
		'posted', d.posted, 'comment', coalesce(d.comment, ''),
		'counterparty', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end,
		'contract', case when k.id is null then null else jsonb_build_object('id', k.id, 'name', k.name) end,
		'total', coalesce(d.total, 0),
		'items', coalesce((select jsonb_agg(jsonb_build_object('lineNo', i.line_no, 'nomenclature', n.name, 'qty', i.qty, 'price', i.price,
			'amount', i.amount, 'vatAmount', coalesce(i.vat_amount, 0), 'total', i.total) order by i.line_no)
			from %s i left join ref.nomenclature n on n.id = i.nomenclature_id where i.doc_id = d.id), '[]'::jsonb))
		from %s d left join ref.counterparty c on c.id = d.counterparty_id left join ref.contract k on k.id = d.contract_id
		where d.id = $1`, docItems[kind], table), did, kind).Scan(&card)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail(404, "not_found", "Документ не найден")
	}
	if err != nil {
		return nil, err
	}
	var out map[string]any
	return out, json.Unmarshal(card, &out)
}

// createSupplierOrder — заказ поставщику (СоздатьЗаказыПоставщикамНаСервере): строки закупок одного поставщика,
// договора и заказа покупателя; проведён; в очередь бухгалтерии.
func (s *Service) createSupplierOrder(ctx context.Context, tx pgx.Tx, a Actor, supplier, contract, customerOrder *uuid.UUID, ls []line, receiptDate time.Time) (uuid.UUID, error) {
	if supplier != nil && contract == nil {
		c, err := findContract(ctx, tx, *supplier)
		if err != nil {
			return uuid.Nil, err
		}
		contract = c
	}
	number, err := nextNumber(ctx, tx, "doc.supplier_order")
	if err != nil {
		return uuid.Nil, err
	}
	id := uuid.Must(uuid.NewV7())
	wh, err := mainWarehouse(ctx, tx)
	if err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `insert into doc.supplier_order (id, number, date, posted, deleted, counterparty_id, contract_id, customer_order_id, organization_id,
		receipt_date, warehouse_id, base_doc_type, base_doc_id, author_id, total, operation) values ($1, $2, $3, true, false, $4, $5, $6, $7, $8, $9, 'doc.customer_order', $6, $10, 0, 'ЗаказНаПокупку')`,
		id, number, s.now(), supplier, contract, customerOrder, organization(ctx, tx), receiptDate, wh, nullable(a.UserID)); err != nil {
		return uuid.Nil, err
	}
	for i, l := range ls {
		amount := round2(l.Quantity * l.SalePrice)
		if _, err := tx.Exec(ctx, `insert into doc.supplier_order_item (id, doc_id, line_no, nomenclature_id, qty, unit_type, unit_id, price, amount, total,
			customer_order_id, receipt_date) values ($1, $2, $3, $4, $5, 'ref.unit', (select unit_id from ref.nomenclature where id = $4), $6, $7, $7, $8, $9)`,
			onec.TabularID(id, int64(i+1)), id, i+1, l.Nomenclature, l.Quantity, l.SalePrice, amount, customerOrder, receiptDate); err != nil {
			return uuid.Nil, err
		}
	}
	if _, err := tx.Exec(ctx, "update doc.supplier_order set total = (select coalesce(sum(total), 0) from doc.supplier_order_item where doc_id = $1) where id = $1", id); err != nil {
		return uuid.Nil, err
	}
	return id, outbox(ctx, tx, "supplier_order", id)
}

// createReceipt — приходная накладная по заказу поставщику (канбан «Собран»): новая партия на строку без партии,
// приход на основной склад под заказ покупателя (stock.move, приход), в очередь бухгалтерии.
func (s *Service) createReceipt(ctx context.Context, tx pgx.Tx, a Actor, supplierOrder uuid.UUID, ls []line) (uuid.UUID, error) {
	var supplier, contract *uuid.UUID
	var supplierName string
	if err := tx.QueryRow(ctx, `select o.counterparty_id, o.contract_id, coalesce(c.name, '') from doc.supplier_order o left join ref.counterparty c on c.id = o.counterparty_id where o.id = $1`,
		supplierOrder).Scan(&supplier, &contract, &supplierName); err != nil {
		return uuid.Nil, err
	}
	number, err := nextNumber(ctx, tx, "doc.receipt")
	if err != nil {
		return uuid.Nil, err
	}
	id := uuid.Must(uuid.NewV7())
	now := s.now()
	wh, err := mainWarehouse(ctx, tx)
	if err != nil {
		return uuid.Nil, err
	}
	org := organization(ctx, tx)
	if _, err := tx.Exec(ctx, `insert into doc.receipt (id, number, date, posted, deleted, counterparty_id, contract_id, supplier_order_type, supplier_order_id,
		base_doc_type, base_doc_id, organization_id, warehouse_id, author_id, total, operation)
		values ($1, $2, $3, true, false, $4, $5, 'doc.supplier_order', $6, 'doc.supplier_order', $6, $7, $8, $9, 0, 'ПоступлениеОтПоставщика')`,
		id, number, now, supplier, contract, supplierOrder, org, wh, nullable(a.UserID)); err != nil {
		return uuid.Nil, err
	}
	for i, l := range ls {
		batch := l.Batch
		if batch == nil {
			b := uuid.Must(uuid.NewV7())
			if _, err := tx.Exec(ctx, `insert into ref.batch (id, deleted, owner_id, name, status, supplier_id, inactive) values ($1, false, $2, $3, 'СобственныеЗапасы', $4, false)`,
				b, l.Nomenclature, fmt.Sprintf("АРМ Поставка (%s) от %s", supplierName, now.Format("02.01.2006")), l.Supplier); err != nil {
				return uuid.Nil, err
			}
			batch = &b
		}
		amount := round2(l.Quantity * l.SalePrice)
		if _, err := tx.Exec(ctx, `insert into doc.receipt_item (id, doc_id, line_no, nomenclature_id, unit_type, unit_id, batch_id, qty, price, amount, total,
			customer_order_id, warehouse_id, order_doc_type, order_doc_id)
			values ($1, $2, $3, $4, 'ref.unit', (select unit_id from ref.nomenclature where id = $4), $5, $6, $7, $8, $8, $9, $10, 'doc.supplier_order', $11)`,
			onec.TabularID(id, int64(i+1)), id, i+1, l.Nomenclature, batch, l.Quantity, l.SalePrice, amount, l.Order, wh, supplierOrder); err != nil {
			return uuid.Nil, err
		}
		if err := move(ctx, tx, "doc.receipt", id, i+1, 0, now, org, wh, l.Nomenclature, batch, l.Order, l.Quantity, amount); err != nil {
			return uuid.Nil, err
		}
	}
	if _, err := tx.Exec(ctx, "update doc.receipt set total = (select coalesce(sum(total), 0) from doc.receipt_item where doc_id = $1) where id = $1", id); err != nil {
		return uuid.Nil, err
	}
	return id, outbox(ctx, tx, "receipt", id)
}

// move — движение регистра остатков (stock.move): 0 — приход, 1 — расход.
func move(ctx context.Context, tx pgx.Tx, recType string, recID uuid.UUID, lineNo int, kind int, period time.Time, org, wh, nom, batch, order *uuid.UUID, qty, amount float64) error {
	id := onec.RegisterID("stock.move", fmt.Sprintf("app:%s:%d", recID, lineNo))
	_, err := tx.Exec(ctx, `insert into stock.move (id, period, recorder_type, recorder_id, line_no, active, movement, organization_id, warehouse_type, warehouse_id,
		nomenclature_id, batch_id, customer_order, qty, amount, onec_key) values ($1, $2, $3, $4, $5, true, $6, $7, 'ref.warehouse', $8, $9, $10, $11, $12, $13, $14)`,
		id, period, recType, recID, lineNo, kind, org, wh, nom, batch, order, qty, amount, "app:"+id.String())
	return err
}

// createShipment — расходная накладная по отмеченным продажам заказа (ОбработатьЧистыеПродажиВФоне): расход партий
// со склада (сначала под заказ, затем свободный), в очередь бухгалтерии.
func (s *Service) createShipment(ctx context.Context, tx pgx.Tx, a Actor, order uuid.UUID, ls []line) (uuid.UUID, string, error) {
	var cust, contract *uuid.UUID
	if err := tx.QueryRow(ctx, "select counterparty_id, contract_id from doc.customer_order where id = $1", order).Scan(&cust, &contract); err != nil {
		return uuid.Nil, "", err
	}
	number, err := nextNumber(ctx, tx, "doc.shipment")
	if err != nil {
		return uuid.Nil, "", err
	}
	id := uuid.Must(uuid.NewV7())
	now := s.now()
	wh, err := mainWarehouse(ctx, tx)
	if err != nil {
		return uuid.Nil, "", err
	}
	org := organization(ctx, tx)
	if _, err := tx.Exec(ctx, `insert into doc.shipment (id, number, date, posted, deleted, counterparty_id, contract_id, customer_order_type, customer_order_id,
		base_doc_type, base_doc_id, organization_id, warehouse_id, author_id, total, operation)
		values ($1, $2, $3, true, false, $4, $5, 'doc.customer_order', $6, 'doc.customer_order', $6, $7, $8, $9, 0, 'ПродажаПокупателю')`,
		id, number, now, cust, contract, order, org, wh, nullable(a.UserID)); err != nil {
		return uuid.Nil, "", err
	}
	for i, l := range ls {
		amount := round2(l.Quantity * l.SalePrice)
		if _, err := tx.Exec(ctx, `insert into doc.shipment_item (id, doc_id, line_no, nomenclature_id, unit_type, unit_id, batch_id, qty, price, amount, total,
			customer_order_id, warehouse_id, order_doc_type, order_doc_id)
			values ($1, $2, $3, $4, 'ref.unit', (select unit_id from ref.nomenclature where id = $4), $5, $6, $7, $8, $8, $9, $10, 'doc.customer_order', $9)`,
			onec.TabularID(id, int64(i+1)), id, i+1, l.Nomenclature, l.Batch, l.Quantity, l.SalePrice, amount, order, wh); err != nil {
			return uuid.Nil, "", err
		}
		// расход: сначала остаток под заказ, затем свободный
		var reserved float64
		_ = tx.QueryRow(ctx, `select coalesce(sum(case when movement = 0 then qty else -qty end), 0)::float8 from stock.move
			where nomenclature_id is not distinct from $1 and batch_id is not distinct from $2 and customer_order = $3 and active`, l.Nomenclature, l.Batch, order).Scan(&reserved)
		fromOrder := min(max(reserved, 0), l.Quantity)
		n := (i + 1) * 2
		if fromOrder > 0 {
			if err := move(ctx, tx, "doc.shipment", id, n-1, 1, now, org, wh, l.Nomenclature, l.Batch, &order, fromOrder, round2(l.CostPrice*fromOrder)); err != nil {
				return uuid.Nil, "", err
			}
		}
		if rest := l.Quantity - fromOrder; rest > 0 {
			if err := move(ctx, tx, "doc.shipment", id, n, 1, now, org, wh, l.Nomenclature, l.Batch, nil, rest, round2(l.CostPrice*rest)); err != nil {
				return uuid.Nil, "", err
			}
		}
	}
	if _, err := tx.Exec(ctx, "update doc.shipment set total = (select coalesce(sum(total), 0) from doc.shipment_item where doc_id = $1) where id = $1", id); err != nil {
		return uuid.Nil, "", err
	}
	return id, number, outbox(ctx, tx, "shipment", id)
}
