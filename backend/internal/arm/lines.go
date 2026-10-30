package arm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var operationByView = map[string]string{"sales": opSale, "purchases": opPurchase, "supply": opPurchase}

func viewOp(view string) string {
	if op, ok := operationByView[view]; ok {
		return op
	}
	return opSale
}

// line — строка для логики команд (столбцы arm.line, нужные правилам).
type line struct {
	ID                      uuid.UUID
	LinkKey                 string
	Operation, Status       string
	Deleted, Marked         bool
	MarkedBy                *uuid.UUID
	Order                   *uuid.UUID
	SupplierOrder, Receipt  *uuid.UUID
	Nomenclature, Batch     *uuid.UUID
	Supplier, Customer      *uuid.UUID
	Contract                *uuid.UUID
	Quantity, CostPrice     float64
	SalePrice, RRC, Coeff   float64
	NormHours, CostSum      float64
	ManualEdit, ManualBatch bool
	ManualSplit, SignedOrig bool
	ShipmentDate            *time.Time
	AssemblySent            *time.Time
	FactName, Comment2      string
	ClientOrderNumber       string
}

const lineSelect = `select id, coalesce(link_key, ''), coalesce(operation, ''), coalesce(status, ''), coalesce(deleted, false), coalesce(marked, false),
	marked_by_id, customer_order_id, supplier_order_id, receipt_id, nomenclature_id, batch_id, supplier_id, customer_id, contract_id,
	coalesce(quantity, 0)::float8, coalesce(cost_price, 0)::float8, coalesce(sale_price, 0)::float8, coalesce(rrc, 0)::float8,
	coalesce(coefficient, 0)::float8, coalesce(norm_hours, 0)::float8, coalesce(cost_sum, 0)::float8,
	coalesce(manual_edit, false), coalesce(manual_batch, false), coalesce(manual_split_by_batch, false), coalesce(signed_original, false),
	shipment_date, assembly_sent_date, coalesce(fact_name, ''), coalesce(comment2, ''), coalesce(client_order_number, '')
	from arm.line`

func scanLines(rows pgx.Rows) ([]line, error) {
	defer rows.Close()
	var out []line
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.ID, &l.LinkKey, &l.Operation, &l.Status, &l.Deleted, &l.Marked, &l.MarkedBy, &l.Order, &l.SupplierOrder,
			&l.Receipt, &l.Nomenclature, &l.Batch, &l.Supplier, &l.Customer, &l.Contract, &l.Quantity, &l.CostPrice, &l.SalePrice,
			&l.RRC, &l.Coeff, &l.NormHours, &l.CostSum, &l.ManualEdit, &l.ManualBatch, &l.ManualSplit, &l.SignedOrig,
			&l.ShipmentDate, &l.AssemblySent, &l.FactName, &l.Comment2, &l.ClientOrderNumber); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func selectLines(ctx context.Context, db querier, where string, args ...any) ([]line, error) {
	rows, err := db.Query(ctx, lineSelect+" where "+where, args...)
	if err != nil {
		return nil, err
	}
	return scanLines(rows)
}

func getLine(ctx context.Context, db querier, id uuid.UUID, lock bool) (*line, error) {
	where := "id = $1"
	if lock {
		where += " for update"
	}
	ls, err := selectLines(ctx, db, where, id)
	if err != nil {
		return nil, err
	}
	if len(ls) == 0 {
		return nil, fail(404, "not_found", fmt.Sprintf("Строка %s не найдена", id))
	}
	return &ls[0], nil
}

func parseID(s string) (uuid.UUID, error) {
	u, err := uuid.Parse(strings.TrimSpace(s))
	if err != nil {
		return uuid.Nil, fail(404, "not_found", "Строка "+s+" не найдена")
	}
	return u, nil
}

// LineJSON — строка в формате API (представление arm.line_api).
func (s *Service) LineJSON(ctx context.Context, id uuid.UUID) (json.RawMessage, error) {
	var b []byte
	err := s.DB.QueryRow(ctx, "select api from arm.line_api where id = $1", id).Scan(&b)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail(404, "not_found", fmt.Sprintf("Строка %s не найдена", id))
	}
	return b, err
}

// Line — GET /lines/{id}.
func (s *Service) Line(ctx context.Context, a Actor, idText string) (json.RawMessage, error) {
	id, err := parseID(idText)
	if err != nil {
		return nil, err
	}
	return s.LineJSON(ctx, id)
}

// LinePage — GET /lines.
type LinePage struct {
	Items      []json.RawMessage `json:"items"`
	NextCursor *string           `json:"nextCursor"`
}

func truthy(v string) bool { return v == "true" || v == "1" }

// Lines — GET /lines: вид, скрыть вычеркнутые/отгруженные, период, заказ, группировка по заказу.
func (s *Service) Lines(ctx context.Context, a Actor, q map[string]string) (*LinePage, error) {
	view := q["view"]
	if view == "" {
		view = "sales"
	}
	where := []string{"l.operation = $1"}
	args := []any{viewOp(view)}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(cond, "?", fmt.Sprintf("$%d", len(args))))
	}
	if q["hideDeleted"] != "false" {
		where = append(where, "not coalesce(l.deleted, false)")
	}
	if truthy(q["hideShipped"]) {
		where = append(where, "l.status not in ('Отгружено', 'Выполнено', 'Завершено')")
	}
	if v := q["periodFrom"]; v != "" {
		add("l.order_date >= ?::date", v)
	}
	if v := q["periodTo"]; v != "" {
		add("l.order_date < ?::date + 1", v)
	}
	if v := q["customerOrderId"]; v != "" {
		add("l.customer_order_id = ?::uuid", v)
	}
	if v := q["clientOrderNumber"]; v != "" {
		add("l.client_order_number = ?", v)
	}
	if v := q["factArticle"]; v != "" {
		add("l.fact_article = ?", v)
	}
	if v := q["warehouseId"]; v != "" {
		add("l.warehouse_id = ?::uuid", v)
	}
	if truthy(q["onlyWithPurchases"]) && view == "sales" {
		where = append(where, "exists (select 1 from arm.line p where p.link_key = l.link_key and p.operation = 'Закупка' and not coalesce(p.deleted, false))")
	}
	limit, _ := strconv.Atoi(q["limit"])
	if limit <= 0 {
		limit = 100
	}
	skip, _ := strconv.Atoi(q["cursor"])
	order := "l.order_date desc nulls last, l.customer_order_id, l.sort_order"
	if q["groupByCustomerOrder"] == "false" {
		order = "l.order_date desc nulls last, l.sort_order"
	}
	rows, err := s.DB.Query(ctx, fmt.Sprintf(`select a.api from arm.line l join arm.line_api a on a.id = l.id where %s order by %s limit %d offset %d`,
		strings.Join(where, " and "), order, limit+1, skip), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	page := &LinePage{Items: []json.RawMessage{}}
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		page.Items = append(page.Items, b)
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		next := strconv.Itoa(skip + limit)
		page.NextCursor = &next
	}
	return page, rows.Err()
}

func requireUser(a Actor) error {
	if a.UserID == uuid.Nil {
		return fail(409, "not_author", fmt.Sprintf("Пользователь «%s» не найден в справочнике «Пользователи» — отметки и команды недоступны", a.UserName))
	}
	return nil
}

func markedByMe(l *line, a Actor) bool { return l.MarkedBy != nil && *l.MarkedBy == a.UserID }

var unmark = map[string]any{"marked": false, "marked_by_id": nil}

func merge(m ...map[string]any) map[string]any {
	out := map[string]any{}
	for _, x := range m {
		for k, v := range x {
			out[k] = v
		}
	}
	return out
}

// fieldValue — значение PATCH {field, value} в значение столбца по виду поля.
func fieldValue(f Field, name string, v any) (any, error) {
	switch f.Kind {
	case "ref":
		var s string
		switch t := v.(type) {
		case map[string]any:
			s, _ = t["id"].(string)
		case string:
			s = t
		}
		if strings.TrimSpace(s) == "" {
			return nil, nil
		}
		u, err := uuid.Parse(s)
		if err != nil {
			return nil, fail(400, "bad_request", name+": не UUID", name)
		}
		return u, nil
	case "date":
		s, _ := v.(string)
		if strings.TrimSpace(s) == "" {
			return nil, nil
		}
		t, err := time.ParseInLocation("2006-01-02", s[:min(10, len(s))], time.Local)
		if err != nil {
			return nil, fail(400, "bad_request", name+": дата ГГГГ-ММ-ДД", name)
		}
		return t, nil
	case "number":
		switch t := v.(type) {
		case float64:
			return t, nil
		case nil:
			return 0.0, nil
		default:
			n, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(fmt.Sprint(t)), ",", "."), 64)
			if err != nil {
				return nil, fail(400, "bad_request", fmt.Sprintf("%s: не число «%v»", name, v), name)
			}
			return n, nil
		}
	case "bool":
		return v == true || v == "true", nil
	default:
		if v == nil {
			return "", nil
		}
		return fmt.Sprint(v), nil
	}
}

// PatchLine — PATCH /lines/{id}: матрица роли по статусу строки, производные поля (себестоимость, цена продажи,
// коэффициент), договор заказчика, смена номенклатуры и пересчёт склада (как форма АРМ и PWA backend.js patchLine).
func (s *Service) PatchLine(ctx context.Context, a Actor, idText, field string, value any) (json.RawMessage, error) {
	if field == "" {
		return nil, fail(400, "bad_request", "field: имя поля регистра", "field")
	}
	id, err := parseID(idText)
	if err != nil {
		return nil, err
	}
	var warning, key, op string
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		l, err := getLine(ctx, tx, id, true)
		if err != nil {
			return err
		}
		key, op = l.LinkKey, l.Operation
		col, ok := columnFor(a.Role, field)
		f, known := Fields[field]
		if !ok || !known {
			return fail(400, "field_readonly", fmt.Sprintf("Поле «%s» нельзя изменить", field), field)
		}
		if why := denyReason(col, l.Status, markedByMe(l, a)); why != "" {
			code := "field_readonly"
			if strings.HasPrefix(why, "матрица") {
				code = "matrix_denied"
			} else if strings.Contains(why, "автор") {
				code = "not_author"
			}
			return fail(403, code, why, field)
		}
		if l.Status == stDone && a.Role != "admin" && field != "ДокументПодписанОригинал" {
			return fail(403, "matrix_denied", "Закрытую строку меняет только администратор", field)
		}
		v, err := fieldValue(f, field, value)
		if err != nil {
			return err
		}
		set := map[string]any{f.Column: v}
		if field == "Договор" && v != nil {
			var owner *uuid.UUID
			_ = tx.QueryRow(ctx, "select counterparty_id from ref.contract where id = $1", v).Scan(&owner)
			if owner == nil || l.Customer == nil || *owner != *l.Customer {
				return fail(409, "contract_owner", "Договор не принадлежит заказчику", field)
			}
		}
		if field == "Покупатель" && l.Contract != nil {
			set["contract_id"] = nil // договор другого владельца сбрасывается
		}
		num := func(k string) float64 { x, _ := set[k].(float64); return x }
		if field == "Количество" || field == "СебестоимостьЕдиницы" {
			qty, price := l.Quantity, l.CostPrice
			if field == "Количество" {
				qty = num("quantity")
			} else {
				price = num("cost_price")
			}
			set["cost_sum"] = round2(qty * price)
		}
		// формулы матрицы: цена продажи = (РРЦ, если есть, иначе себестоимость) × коэффициент; ручная цена — коэффициент
		if l.Operation == opSale {
			rrc, cost, coeff, price := l.RRC, l.CostPrice, l.Coeff, l.SalePrice
			switch field {
			case "РРЦ":
				rrc = num("rrc")
			case "СебестоимостьЕдиницы":
				cost = num("cost_price")
			case "Коэффициент":
				coeff = num("coefficient")
			case "Цена":
				price = num("sale_price")
			}
			base := rrc
			if base == 0 {
				base = cost
			}
			if base != 0 && field == "Цена" {
				set["coefficient"], set["price_change_type"] = price/base, 1
			} else if base != 0 && coeff != 0 && contains([]string{"Коэффициент", "РРЦ", "СебестоимостьЕдиницы"}, field) {
				set["sale_price"] = round2(base * coeff)
				if field == "Коэффициент" {
					set["price_change_type"] = 2
				}
			}
		}
		if field == "ДокументПодписанОригинал" && v == true {
			set = merge(set, unmark)
		}
		if field == "Номенклатура" && l.Operation == opSale {
			var nom *uuid.UUID
			if u, ok := v.(uuid.UUID); ok {
				nom = &u
			}
			warning, err = s.changeNomenclature(ctx, tx, a, l, nom)
			return err
		}
		if field == "СтатусСтроки" {
			return fail(400, "field_readonly", "Статус меняется переходами процесса (POST /lines/transition)", field)
		}
		if err := updateLine(ctx, tx, l.ID, set); err != nil {
			return err
		}
		// пересчёт склада — после количества продажи или ручной закупки (как форма АРМ, команда ПересчитатьСтроку)
		if field == "Количество" && l.Nomenclature != nil && (l.Operation == opSale || l.ManualEdit) {
			return s.recalcStock(ctx, tx, a, *l.Nomenclature, l.Order)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out, err := s.lineAfterRecalc(ctx, id, key, op)
	if err != nil || warning == "" {
		return out, err
	}
	var m map[string]any
	_ = json.Unmarshal(out, &m)
	m["warning"] = warning
	return json.Marshal(m)
}

// lineAfterRecalc — после пересчёта строка могла слиться с другой записью ключа (СхлопнутьСтрокиПродажПартии
// оставляет запись с наибольшим ИдентификаторЗаписи): тогда — запись того же ключа связи и вида операции.
func (s *Service) lineAfterRecalc(ctx context.Context, id uuid.UUID, key, op string) (json.RawMessage, error) {
	out, err := s.LineJSON(ctx, id)
	if err == nil || key == "" {
		return out, err
	}
	var alt uuid.UUID
	if e := s.DB.QueryRow(ctx, `select id from arm.line where link_key = $1 and operation = $2 and not coalesce(deleted, false)
		order by sort_order limit 1`, key, op).Scan(&alt); e != nil {
		return nil, err
	}
	return s.LineJSON(ctx, alt)
}

// ToggleMark — POST /lines/{id}/mark.
func (s *Service) ToggleMark(ctx context.Context, a Actor, idText string) (json.RawMessage, error) {
	if err := requireUser(a); err != nil {
		return nil, err
	}
	id, err := parseID(idText)
	if err != nil {
		return nil, err
	}
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		l, err := getLine(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if l.Marked && !markedByMe(l, a) {
			var who string
			_ = tx.QueryRow(ctx, `select name from auth."user" where id = $1`, l.MarkedBy).Scan(&who)
			return fail(409, "not_author", "Строку отметил другой пользователь: "+who)
		}
		if l.Marked {
			return updateLine(ctx, tx, id, unmark)
		}
		return updateLine(ctx, tx, id, map[string]any{"marked": true, "marked_by_id": a.UserID})
	})
	if err != nil {
		return nil, err
	}
	return s.LineJSON(ctx, id)
}

// Selection — GET /selection: итоги отмеченных строк вида.
func (s *Service) Selection(ctx context.Context, a Actor, view string) (map[string]any, error) {
	var count int
	var qty, sale, cost float64
	err := s.DB.QueryRow(ctx, `select count(*), coalesce(sum(quantity), 0)::float8,
		coalesce(sum(case when coalesce(norm_hours, 0) > 0 then norm_hours else coalesce(quantity, 0) end * coalesce(sale_price, 0)), 0)::float8,
		coalesce(sum(cost_sum), 0)::float8 from arm.line
		where marked and marked_by_id = $1 and operation = $2 and not coalesce(deleted, false)`, a.UserID, viewOp(view)).Scan(&count, &qty, &sale, &cost)
	return map[string]any{"count": count, "quantity": qty, "saleSum": sale, "costSum": cost}, err
}

// MarkOrder — POST /selection: отметить / снять все строки заказа вида.
func (s *Service) MarkOrder(ctx context.Context, a Actor, view, orderID string, marked *bool) (map[string]any, error) {
	if err := requireUser(a); err != nil {
		return nil, err
	}
	if marked == nil {
		return nil, fail(400, "bad_request", "marked: true или false", "marked")
	}
	var n, total int
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		ls, err := selectLines(ctx, tx, "customer_order_id = $1::uuid and operation = $2 and not coalesce(deleted, false) for update", orderID, viewOp(view))
		if err != nil {
			return err
		}
		total = len(ls)
		for i := range ls {
			l := &ls[i]
			free := l.MarkedBy == nil || *l.MarkedBy == a.UserID
			if !free || l.Marked == *marked {
				continue
			}
			set := unmark
			if *marked {
				set = map[string]any{"marked": true, "marked_by_id": a.UserID}
			}
			if err := updateLine(ctx, tx, l.ID, set); err != nil {
				return err
			}
			n++
		}
		return nil
	})
	return map[string]any{"processed": n, "total": total}, err
}

// AddLines — POST /lines: подбор номенклатуры в заказ (продажа) или закупка под строку продажи.
func (s *Service) AddLines(ctx context.Context, a Actor, view, orderID, sourceLineID string, noms []string) ([]json.RawMessage, error) {
	if len(noms) == 0 {
		return nil, fail(400, "bad_request", "nomenclatureIds: непустой массив", "nomenclatureIds")
	}
	if col, ok := columnFor(a.Role, "Номенклатура"); !ok || len(col.Rights) == 0 || col.Rights[0] != '+' {
		return nil, fail(403, "matrix_denied", fmt.Sprintf("Матрица не разрешает роли %s подбирать номенклатуру в статусе «Новый»", a.Role), "Номенклатура")
	}
	var ids []uuid.UUID
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		tpl := map[string]any{}
		if view == "purchases" {
			sid, err := parseID(sourceLineID)
			if err != nil {
				return err
			}
			var order *uuid.UUID
			var key, cno, num, fname, fqty string
			var cust, contr *uuid.UUID
			var odate *time.Time
			if err := tx.QueryRow(ctx, `select customer_order_id, coalesce(link_key, ''), customer_id, contract_id, coalesce(client_order_number, ''),
				order_date, coalesce(internal_order_number, ''), coalesce(fact_name, ''), coalesce(fact_qty, '') from arm.line where id = $1`, sid).
				Scan(&order, &key, &cust, &contr, &cno, &odate, &num, &fname, &fqty); err != nil {
				return fail(404, "not_found", "Строка "+sourceLineID+" не найдена")
			}
			tpl = map[string]any{"customer_order_id": order, "link_key": key, "customer_id": cust, "contract_id": contr, "client_order_number": cno,
				"order_date": odate, "internal_order_number": num, "fact_name": fname, "fact_qty": fqty}
		} else {
			var cp, contr *uuid.UUID
			var number, cno string
			var date time.Time
			oid, err := uuid.Parse(orderID)
			if err != nil {
				return fail(404, "not_found", "Заказ покупателя не найден")
			}
			if err := tx.QueryRow(ctx, `select counterparty_id, contract_id, number, date, coalesce(client_order_number, '') from doc.customer_order where id = $1`, oid).
				Scan(&cp, &contr, &number, &date, &cno); err != nil {
				return fail(404, "not_found", "Заказ покупателя не найден")
			}
			tpl = map[string]any{"customer_order_id": oid, "customer_id": cp, "contract_id": contr, "client_order_number": cno, "order_date": date, "internal_order_number": number}
		}
		var order float64
		_ = tx.QueryRow(ctx, "select coalesce(max(sort_order), 0)::float8 from arm.line").Scan(&order)
		for _, n := range noms {
			nid, err := uuid.Parse(n)
			if err != nil {
				return fail(400, "bad_request", "nomenclatureIds: UUID", "nomenclatureIds")
			}
			order++
			set := merge(tpl, map[string]any{"operation": viewOp(view), "manual_edit": view == "purchases", "nomenclature_id": nid,
				"status": stDraft, "sort_order": order, "deleted": false, "marked": false})
			if view != "purchases" {
				set["link_key"] = uuid.NewString()
			}
			id, err := insertLine(ctx, tx, set)
			if err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out := make([]json.RawMessage, 0, len(ids))
	for _, id := range ids {
		b, err := s.LineJSON(ctx, id)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}

// statusSet — статус и дата отправки на сборку при «Комплектуется» (ОтметитьДатуОтправкиНаСборку).
func (s *Service) statusSet(l *line, status string) map[string]any {
	set := map[string]any{"status": status}
	if status == stAssembly && l.AssemblySent == nil {
		set["assembly_sent_date"] = dayStart(s.now())
	}
	return set
}

// Transition — POST /lines/transition: переход отмеченных строк вида по таблице Transitions и роли.
func (s *Service) Transition(ctx context.Context, a Actor, view, to string) (map[string]any, error) {
	if view != "sales" && view != "purchases" {
		return nil, fail(400, "bad_request", "view: sales или purchases", "view")
	}
	if err := requireUser(a); err != nil {
		return nil, err
	}
	var all, mine []Transition
	for _, t := range Transitions {
		if t.To == to {
			all = append(all, t)
			if contains(t.Roles, a.Role) {
				mine = append(mine, t)
			}
		}
	}
	if len(all) == 0 {
		return nil, fail(400, "bad_request", "to: reserve, assembly, ready_to_ship, shipped, acceptance, return, closed", "to")
	}
	if len(mine) == 0 {
		return nil, fail(403, "matrix_denied", fmt.Sprintf("Переход «%s» недоступен роли %s", to, a.Role))
	}
	var done, total int
	var skipped []string
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		marked, err := selectLines(ctx, tx, "marked and marked_by_id = $1 and operation = $2 and not coalesce(deleted, false) order by sort_order for update", a.UserID, viewOp(view))
		if err != nil {
			return err
		}
		total = len(marked)
		if total == 0 {
			return fail(409, "nothing_marked", "Нет отмеченных строк")
		}
		for i := range marked {
			l := &marked[i]
			st := apiStatus(l.Status)
			var t *Transition
			for k := range mine {
				if contains(mine[k].From, st) {
					t = &mine[k]
					break
				}
			}
			name := l.FactName
			if name == "" {
				name = l.ID.String()
			}
			if t == nil {
				skipped = append(skipped, fmt.Sprintf("%s: из «%s» нельзя", name, st))
				continue
			}
			if to == "closed" && st == "shipped" && !l.SignedOrig {
				skipped = append(skipped, name+": не отмечено «Документ подписан оригинал»")
				continue
			}
			if err := updateLine(ctx, tx, l.ID, merge(s.statusSet(l, t.Status), unmark)); err != nil {
				return err
			}
			done++
			if view == "purchases" { // закупка ведёт за собой связанную продажу в том же статусе
				sales, err := selectLines(ctx, tx, "link_key = $1 and operation = 'Продажа' and not coalesce(deleted, false) and status = $2", l.LinkKey, l.Status)
				if err != nil {
					return err
				}
				for k := range sales {
					if err := updateLine(ctx, tx, sales[k].ID, s.statusSet(&sales[k], t.Status)); err != nil {
						return err
					}
				}
			}
		}
		if done == 0 {
			from := map[string]bool{}
			var list []string
			for _, t := range mine {
				for _, f := range t.From {
					if !from[f] {
						from[f] = true
						list = append(list, f)
					}
				}
			}
			return fail(409, "transition_denied", fmt.Sprintf("Переход «%s» не применён: %s. Допустимо из: %s", to, strings.Join(skipped, "; "), strings.Join(list, ", ")))
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

// Prepared — POST /sales/prepared: «Подготовлено» для отмеченных продаж «В работе» без незавершённых закупок.
func (s *Service) Prepared(ctx context.Context, a Actor) (map[string]any, error) {
	if err := requireUser(a); err != nil {
		return nil, err
	}
	var ready, total int
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		marked, err := selectLines(ctx, tx, "marked and marked_by_id = $1 and operation = 'Продажа' and not coalesce(deleted, false) and status = 'ВРаботе' for update", a.UserID)
		if err != nil {
			return err
		}
		total = len(marked)
		if total == 0 {
			return fail(409, "nothing_marked", "Нет отмеченных строк продажи в статусе «В работе»")
		}
		for i := range marked {
			l := &marked[i]
			var open bool
			_ = tx.QueryRow(ctx, "select exists(select 1 from arm.line where link_key = $1 and operation = 'Закупка' and status <> 'НаСкладе' and not coalesce(deleted, false))", l.LinkKey).Scan(&open)
			if l.Nomenclature == nil || l.Supplier == nil || l.Quantity == 0 || l.SalePrice == 0 || open {
				continue
			}
			if err := updateLine(ctx, tx, l.ID, merge(map[string]any{"status": stPrepared}, unmark)); err != nil {
				return err
			}
			ready++
		}
		if ready == 0 {
			return fail(409, "unfinished_purchase", "В строках есть незавершённые закупки или не заполнены номенклатура, поставщик, количество, цена")
		}
		return nil
	})
	return map[string]any{"processed": ready, "total": total}, err
}

// RejectAssembly — POST /lines/reject-assembly (M10): «Собран»/«Подготовлено» -> «Комплектуется» с причиной в «Комментарий 2».
func (s *Service) RejectAssembly(ctx context.Context, a Actor, reason string) (map[string]any, error) {
	if err := requireUser(a); err != nil {
		return nil, err
	}
	if !contains([]string{"manager", "admin", "chief_mechanic"}, a.Role) {
		return nil, fail(403, "matrix_denied", "Отклонить комплектацию может менеджер, механик или администратор")
	}
	why := strings.TrimSpace(reason)
	if why == "" {
		return nil, fail(400, "bad_request", "reason: причина отклонения", "reason")
	}
	var n int
	err := s.inTx(ctx, a, func(tx pgx.Tx) error {
		marked, err := selectLines(ctx, tx, "marked and marked_by_id = $1 and operation = 'Продажа' and not coalesce(deleted, false) and status in ('Собран', 'Подготовлено') for update", a.UserID)
		if err != nil {
			return err
		}
		if len(marked) == 0 {
			return fail(409, "nothing_marked", "Нет отмеченных строк продажи в статусе «Собран» или «Подготовлено»")
		}
		head := fmt.Sprintf("Отклонено %s: %s", s.now().Format("02.01 15:04"), why)
		for i := range marked {
			text := head
			if marked[i].Comment2 != "" {
				text += " | " + marked[i].Comment2
			}
			if r := []rune(text); len(r) > 150 {
				text = string(r[:150])
			}
			if err := updateLine(ctx, tx, marked[i].ID, merge(map[string]any{"status": stAssembly, "comment2": text}, unmark)); err != nil {
				return err
			}
			n++
		}
		return nil
	})
	return map[string]any{"processed": n, "total": n}, err
}

// Shipments — POST /sales/shipments (M12): дата и номер отгрузки строкам заказа, готовым к отгрузке.
func (s *Service) Shipments(ctx context.Context, a Actor, orderID, date, number string) (map[string]any, error) {
	if date == "" || number == "" {
		return nil, fail(400, "bad_request", "Нужны shipmentDate и shipmentNumber")
	}
	d, err := time.ParseInLocation("2006-01-02", date, time.Local)
	if err != nil {
		return nil, fail(400, "bad_request", "shipmentDate: ГГГГ-ММ-ДД", "shipmentDate")
	}
	var n, total int
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		ls, err := selectLines(ctx, tx, "customer_order_id = $1::uuid and operation = 'Продажа' and not coalesce(deleted, false) for update", orderID)
		if err != nil {
			return err
		}
		total = len(ls)
		for i := range ls {
			l := &ls[i]
			free := l.MarkedBy == nil || *l.MarkedBy == a.UserID
			inWork := l.Batch != nil && (l.Status == stInWork || l.Status == stDraft)
			ready := contains([]string{stAssembled, stPrepared, stReturn}, l.Status)
			if free && (inWork || ready) {
				if err := updateLine(ctx, tx, l.ID, map[string]any{"shipment_date": d, "shipment_number": number}); err != nil {
					return err
				}
				n++
			}
		}
		return nil
	})
	return map[string]any{"processed": n, "total": total}, err
}

// StrikeLine — DELETE /lines/{id} (F-1): продажа и незаказанные закупки ключа вычеркиваются, строка уходит из заказа.
func (s *Service) StrikeLine(ctx context.Context, a Actor, idText string) error {
	id, err := parseID(idText)
	if err != nil {
		return err
	}
	return s.inTx(ctx, a, func(tx pgx.Tx) error {
		l, err := getLine(ctx, tx, id, true)
		if err != nil {
			return err
		}
		st := apiStatus(l.Status)
		if st != "new" && st != "in_work" {
			return fail(409, "row_locked", "Вычеркнуть можно только строку в статусе «Черновик» или «В работе»")
		}
		if l.MarkedBy != nil && *l.MarkedBy != a.UserID {
			return fail(409, "not_author", "Строку отметил другой пользователь")
		}
		return s.strikeKeys(ctx, tx, a, []string{l.LinkKey}, true)
	})
}

// strikeKeys — ВычеркнутьСтрокиПоКлючам: продажа и закупки без заказа поставщику -> Удаление, пересчёт, строки заказа.
func (s *Service) strikeKeys(ctx context.Context, tx pgx.Tx, a Actor, keys []string, strike bool) error {
	type pair struct{ nom, order uuid.UUID }
	recalc := map[pair]bool{}
	orders := map[uuid.UUID]bool{}
	allowed := []string{stDraft, stInWork}
	for _, key := range keys {
		ls, err := selectLines(ctx, tx, "link_key = $1 for update", key)
		if err != nil {
			return err
		}
		var sale *line
		for i := range ls {
			if ls[i].Operation == opSale {
				sale = &ls[i]
				break
			}
		}
		if sale == nil {
			continue
		}
		if !contains(allowed, sale.Status) {
			return fail(409, "row_locked", fmt.Sprintf("Вычеркнуть можно только строку в статусе «Черновик» или «В работе»: статус «%s»", sale.Status))
		}
		for i := range ls {
			l := &ls[i]
			if l.Operation == opPurchase && (l.SupplierOrder != nil || !contains(allowed, l.Status)) {
				continue // заказанная закупка остаётся (её отменяют в заказе поставщику)
			}
			set := merge(map[string]any{"deleted": strike}, unmark)
			if l.Operation == opSale {
				set["status"] = stDraft
				if !strike {
					set["status"] = stInWork
				}
			}
			if err := updateLine(ctx, tx, l.ID, set); err != nil {
				return err
			}
			if l.Nomenclature != nil {
				o := uuid.Nil
				if l.Order != nil {
					o = *l.Order
				}
				recalc[pair{*l.Nomenclature, o}] = true
			}
		}
		if sale.Order != nil {
			orders[*sale.Order] = true
		}
	}
	for p := range recalc {
		var order *uuid.UUID
		if p.order != uuid.Nil {
			order = uptr(p.order)
		}
		if err := s.recalcStock(ctx, tx, a, p.nom, order); err != nil {
			return err
		}
	}
	for o := range orders {
		if err := syncOrderItems(ctx, tx, o); err != nil {
			return err
		}
	}
	return nil
}

// changeNomenclature — СменитьНоменклатуруСтроки (F-2): новый ключ связи продажи, незаказанные закупки старого ключа
// удаляются (по заказанным — предупреждение), строка заказа покупателя получает новую номенклатуру, пересчёт старой и новой.
func (s *Service) changeNomenclature(ctx context.Context, tx pgx.Tx, a Actor, l *line, nom *uuid.UUID) (string, error) {
	if (l.Nomenclature == nil && nom == nil) || (l.Nomenclature != nil && nom != nil && *l.Nomenclature == *nom) {
		return "", nil
	}
	if nom != nil {
		var ok bool
		_ = tx.QueryRow(ctx, "select exists(select 1 from ref.nomenclature where id = $1)", nom).Scan(&ok)
		if !ok {
			return "", fail(400, "bad_request", "Номенклатура не найдена", "Номенклатура")
		}
	}
	oldKey, newKey := l.LinkKey, uuid.NewString()
	var warn []string
	ps, err := selectLines(ctx, tx, "link_key = $1 and operation = 'Закупка' for update", oldKey)
	if err != nil {
		return "", err
	}
	for _, p := range ps {
		if p.SupplierOrder != nil {
			var num string
			_ = tx.QueryRow(ctx, "select number from doc.supplier_order where id = $1", p.SupplierOrder).Scan(&num)
			warn = append(warn, fmt.Sprintf("Закупка уже заказана (%s) — отмените её в заказе поставщику.", num))
		} else if _, err := tx.Exec(ctx, "delete from arm.line where id = $1", p.ID); err != nil {
			return "", err
		}
	}
	prio, err := priority(ctx, tx, nom)
	if err != nil {
		return "", err
	}
	if err := updateLine(ctx, tx, l.ID, map[string]any{"link_key": newKey, "batch_id": nil, "nomenclature_id": nom, "sort_order": prio, "stock_qty": 0}); err != nil {
		return "", err
	}
	if l.Order != nil {
		if _, err := tx.Exec(ctx, `update doc.customer_order_item set arm_link_key = $2, nomenclature_id = $3, nomenclature_type = case when $3::uuid is null then null else 'ref.nomenclature' end,
			unit_id = (select unit_id from ref.nomenclature where id = $3), unit_type = 'ref.unit', version = version + 1, updated_at = now()
			where doc_id = $1 and arm_link_key = $4`, l.Order, newKey, nom, oldKey); err != nil {
			return "", err
		}
	}
	if l.Nomenclature != nil {
		if err := s.recalcStock(ctx, tx, a, *l.Nomenclature, l.Order); err != nil {
			return "", err
		}
	}
	if nom != nil {
		if err := s.recalcStock(ctx, tx, a, *nom, l.Order); err != nil {
			return "", err
		}
	}
	return strings.Join(warn, " "), nil
}
