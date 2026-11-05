package arm

import (
	"bytes"
	"context"
	_ "embed"
	"fmt"
	"html/template"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Печатные формы АРМ (перенос Арм_ПечатьСервер 2.23; образец оформления — формы 1С, docs/migration/TZ.md ТР-Ф12):
//   shipment_sheet       M12  отгрузочная ведомость: продажи «Собран» / «Подготовлено» / «Отгружено»
//   assembly_sheet       K3   сборочный лист: «Комплектуется» / «Резервирование» — ячейка, «собрано», «дефект / недостача»
//   shipment_correction  M19  корректировка ведомости: «Возврат»
//   work_order           G9   заказ-наряд автосервиса: работы (нормо-часы) + запчасти (doc.work_order*)

type printKind struct {
	Title    string
	Statuses []string
	Prices   bool
	Assembly bool
}

var printKinds = map[string]printKind{
	"shipment_sheet":      {"Отгрузочная ведомость", []string{stAssembled, stPrepared, stShipped}, true, false},
	"assembly_sheet":      {"Сборочный лист", []string{stAssembly, stReserve}, false, true},
	"shipment_correction": {"Корректировка отгрузочной ведомости", []string{stReturn}, true, false},
}

//go:embed print.html.tmpl
var printTemplate string

//go:embed work_order.html.tmpl
var workOrderTemplate string

var printTpl = template.Must(template.New("print").Funcs(template.FuncMap{
	"money": func(x float64) string { return formatNumber(x, 2) },
	"qty":   func(x float64) string { return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.3f", x), "0"), ".") },
}).Parse(printTemplate))

var workOrderTpl = template.Must(template.New("workorder").Funcs(template.FuncMap{
	"money": func(x float64) string { return formatNumber(x, 2) },
	"qty":   func(x float64) string { return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.3f", x), "0"), ".") },
}).Parse(workOrderTemplate))

type printRow struct {
	No                  int
	Cell, Article, Name string
	Batch, Unit         string
	Qty, Price, Sum     float64
}

type printOrder struct {
	Title    string
	Lines    []string
	Rows     []printRow
	Assembly bool
	Prices   bool
	Count    int
	QtyTotal float64
	Total    float64
	Signs    []string
}

// Print — POST /print: HTML формы по заказам покупателя (каждый заказ — отдельная страница).
func (s *Service) Print(ctx context.Context, kind string, orderIDs []string) (string, error) {
	k, ok := printKinds[kind]
	if !ok {
		return "", fail(400, "bad_request", "kind: shipment_sheet, assembly_sheet, shipment_correction", "kind")
	}
	var ids []uuid.UUID
	seen := map[uuid.UUID]bool{}
	for _, s := range orderIDs {
		if u, err := uuid.Parse(s); err == nil && !seen[u] {
			seen[u] = true
			ids = append(ids, u)
		}
	}
	if len(ids) == 0 {
		return "", fail(400, "bad_request", "customerOrderIds: заказы покупателя (отметьте строки или откройте строку)", "customerOrderIds")
	}
	rows, err := s.DB.Query(ctx, `select o.id, o.number, o.date, coalesce(org.name, ''), coalesce(c.name, ''), coalesce(ct.name, ''),
		coalesce(l.client_order_number, ''), coalesce(l.vehicle_plate, ''), coalesce(l.territory, ''), l.shipment_number, l.shipment_date, l.assembly_sent_date,
		coalesce(cell.code, l.cell_legacy, ''), coalesce(nullif(n.article, ''), l.fact_article, ''), coalesce(n.name, l.fact_name, ''), coalesce(b.name, ''),
		coalesce(u.name, l.fact_unit, ''), coalesce(l.quantity, 0)::float8, coalesce(l.sale_price, 0)::float8
		from arm.line l join doc.customer_order o on o.id = l.customer_order_id
		left join ref.organization org on org.id = o.organization_id left join ref.counterparty c on c.id = l.customer_id
		left join ref.contract ct on ct.id = l.contract_id left join ref.nomenclature n on n.id = l.nomenclature_id
		left join ref.unit u on u.id = n.unit_id left join ref.batch b on b.id = l.batch_id left join ref.storage_cell cell on cell.id = l.cell_id
		where l.operation = 'Продажа' and not coalesce(l.deleted, false) and l.customer_order_id = any($1) and l.status = any($2)
		order by o.date, o.id, l.sort_order`, ids, k.Statuses)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var orders []*printOrder
	var cur *printOrder
	var curID uuid.UUID
	for rows.Next() {
		var oid uuid.UUID
		var number, org, cust, contract, cno, plate, terr, cell, art, name, batch, unit string
		var odate time.Time
		var shipNo *string
		var shipDate, sent *time.Time
		var r printRow
		if err := rows.Scan(&oid, &number, &odate, &org, &cust, &contract, &cno, &plate, &terr, &shipNo, &shipDate, &sent, &cell, &art, &name, &batch, &unit, &r.Qty, &r.Price); err != nil {
			return "", err
		}
		if cur == nil || oid != curID {
			cur, curID = &printOrder{Title: k.Title, Assembly: k.Assembly, Prices: k.Prices}, oid
			if !k.Assembly && shipNo != nil && strings.TrimSpace(*shipNo) != "" {
				cur.Title += " № " + strings.TrimSpace(*shipNo)
				if shipDate != nil {
					cur.Title += " от " + shipDate.Format("02.01.2006")
				}
			}
			if org != "" {
				cur.Lines = append(cur.Lines, "Поставщик: "+org)
			}
			buyer := "Покупатель: " + cust
			if contract != "" {
				buyer += ", договор " + contract
			}
			cur.Lines = append(cur.Lines, buyer)
			ord := fmt.Sprintf("Заказ покупателя: %s от %s", strings.TrimSpace(number), odate.Format("02.01.2006"))
			if cno != "" {
				ord += ", заявка клиента № " + cno
			}
			cur.Lines = append(cur.Lines, ord)
			if plate != "" || terr != "" {
				car := "Машина (ГРЗ): " + plate
				if terr != "" {
					car += ", территория: " + terr
				}
				cur.Lines = append(cur.Lines, car)
			}
			switch {
			case k.Assembly:
				sentText := "—"
				if sent != nil {
					sentText = sent.Format("02.01.2006")
				}
				cur.Lines = append(cur.Lines, fmt.Sprintf("Отправлено на сборку: %s;  напечатано %s", sentText, s.now().Format("02.01.2006 15:04:05")))
				cur.Signs = []string{"Собрал (кладовщик) ____________________ / ____________________", "Проверил ____________________ / ____________________"}
			case kind == "shipment_correction":
				corr := "Возврат от покупателя: позиции ниже исключаются из отгрузки"
				if shipNo != nil && *shipNo != "" {
					corr += " № " + strings.TrimSpace(*shipNo)
				}
				cur.Lines = append(cur.Lines, corr+".")
				cur.Signs = []string{"Возврат принял (кладовщик) ____________________ / ____________________", "Сдал (покупатель) ____________________ / ____________________"}
			default:
				cur.Signs = []string{"Отпустил ____________________ / ____________________", "Получил ____________________ / ____________________", "Оригиналы документов получены: ☐   дата ____________"}
			}
			orders = append(orders, cur)
		}
		cur.Count++
		r.No, r.Cell, r.Article, r.Name, r.Batch, r.Unit = cur.Count, cell, art, name, batch, unit
		r.Sum = round2(r.Qty * r.Price)
		cur.Rows = append(cur.Rows, r)
		cur.QtyTotal += r.Qty
		cur.Total += r.Sum
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if len(orders) == 0 {
		return "", fail(409, "nothing_to_print", fmt.Sprintf("%s: в выбранных заказах нет строк в статусе %s", k.Title, joinQuoted(k.Statuses)))
	}
	var buf bytes.Buffer
	if err := printTpl.Execute(&buf, map[string]any{"Title": k.Title, "Orders": orders}); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// ——— G9: печатная форма заказ-наряда ———

type woLaborRow struct {
	No            int
	Name          string
	Qty, Price, Sum float64
}

type woPartRow struct {
	No                  int
	Article, Name, Unit string
	Qty                 float64
	Status              string
}

type woPrint struct {
	Number, Date      string
	Lines             []string
	Labor             []woLaborRow
	Parts             []woPartRow
	NormHoursTotal    float64
	LaborSum          float64
	PartsSum          float64
	GrandTotal        float64
	PartsCount        int
	PartsQtyTotal     float64
	Comment           string
}

// PrintWorkOrder — POST /print kind=work_order: заказ-наряд (работы + запчасти), G9.
func (s *Service) PrintWorkOrder(ctx context.Context, ids []string) (string, error) {
	var uuids []uuid.UUID
	seen := map[uuid.UUID]bool{}
	for _, str := range ids {
		if u, err := uuid.Parse(str); err == nil && !seen[u] {
			seen[u] = true
			uuids = append(uuids, u)
		}
	}
	if len(uuids) == 0 {
		return "", fail(400, "bad_request", "workOrderIds: заказ-наряды (отметьте или откройте)", "workOrderIds")
	}

	// Шапки
	hdrs, err := s.DB.Query(ctx, `select w.id, coalesce(w.number, ''), w.date, coalesce(k.name, ''),
			coalesce(car.name, ''), coalesce(car.vin, ''), coalesce(org.name, ''), coalesce(w.comment, ''),
			w.total_norm_hours::float8, w.labor_sum::float8, w.parts_sum::float8, w.status
		from doc.work_order w
		left join ref.car car on car.id = w.car_id
		left join ref.counterparty k on k.id = w.customer_id
		left join ref.organization org on org.id = (select o.organization_id from doc.customer_order o where o.id = w.customer_order_id)
		where w.id = any($1) and not w.deleted order by w.date, w.id`, uuids)
	if err != nil {
		return "", err
	}
	defer hdrs.Close()

	var orders []*woPrint
	idx := map[uuid.UUID]*woPrint{}
	for hdrs.Next() {
		var id uuid.UUID
		var number, cust, carName, vin, org, comment, status string
		var odate *time.Time
		var nh, laborSum, partsSum float64
		if err := hdrs.Scan(&id, &number, &odate, &cust, &carName, &vin, &org, &comment, &nh, &laborSum, &partsSum, &status); err != nil {
			return "", err
		}
		o := &woPrint{Number: strings.TrimSpace(number), NormHoursTotal: nh, LaborSum: laborSum, PartsSum: partsSum, Comment: comment}
		if odate != nil {
			o.Date = odate.Format("02.01.2006")
		} else {
			o.Date = s.now().Format("02.01.2006")
		}
		o.GrandTotal = round2(laborSum + partsSum)
		if org != "" {
			o.Lines = append(o.Lines, "Организация: "+org)
		}
		if cust != "" {
			o.Lines = append(o.Lines, "Клиент: "+cust)
		}
		car := "Автомобиль: " + carName
		if vin != "" {
			car += ", VIN: " + vin
		}
		if carName != "" || vin != "" {
			o.Lines = append(o.Lines, car)
		}
		if status == "released" {
			o.Lines = append(o.Lines, "Статус: выдан")
		}
		o.Lines = append(o.Lines, "Напечатано: "+s.now().Format("02.01.2006 15:04:05"))
		orders = append(orders, o)
		idx[id] = o
	}
	if err := hdrs.Err(); err != nil {
		return "", err
	}
	if len(orders) == 0 {
		return "", fail(409, "nothing_to_print", "Заказ-наряд: заказ-наряды не найдены", "workOrderIds")
	}

	// Работы (нормо-часы)
	lr, err := s.DB.Query(ctx, `select wl.work_order_id, coalesce(sk.name, ''), wl.quantity::float8, wl.hour_price::float8, wl.amount::float8, coalesce(wl.comment, '')
		from doc.work_order_labor wl
		left join ref.service_kind sk on sk.id = wl.service_kind_id
		where wl.work_order_id = any($1) and not wl.deleted order by wl.created_at`, uuids)
	if err != nil {
		return "", err
	}
	defer lr.Close()
	for lr.Next() {
		var woID uuid.UUID
		var name, cmt string
		var qty, price, sum float64
		if err := lr.Scan(&woID, &name, &qty, &price, &sum, &cmt); err != nil {
			return "", err
		}
		o := idx[woID]
		if o == nil || name == "" {
			name = cmt
		}
		o.Labor = append(o.Labor, woLaborRow{No: len(o.Labor) + 1, Name: name, Qty: qty, Price: price, Sum: sum})
	}

	// Запчасти
	pr, err := s.DB.Query(ctx, `select wol.work_order_id, coalesce(nullif(n.article, ''), l.fact_article, ''), coalesce(n.name, l.fact_name, ''),
			coalesce(u.name, l.fact_unit, ''), wol.quantity::float8, coalesce(l.status, '')
		from doc.work_order_line wol
		left join ref.nomenclature n on n.id = wol.nomenclature_id
		left join ref.unit u on u.id = n.unit_id
		left join arm.line l on l.id = wol.line_id
		where wol.work_order_id = any($1) and not wol.deleted order by wol.created_at`, uuids)
	if err != nil {
		return "", err
	}
	defer pr.Close()
	for pr.Next() {
		var woID uuid.UUID
		var art, name, unit, lineStatus string
		var qty float64
		if err := pr.Scan(&woID, &art, &name, &unit, &qty, &lineStatus); err != nil {
			return "", err
		}
		o := idx[woID]
		o.Parts = append(o.Parts, woPartRow{No: len(o.Parts) + 1, Article: art, Name: name, Unit: unit, Qty: qty, Status: lineStatus})
	}

	for _, o := range orders {
		o.PartsCount = len(o.Parts)
		for _, p := range o.Parts {
			o.PartsQtyTotal += p.Qty
		}
	}

	var buf bytes.Buffer
	if err := workOrderTpl.Execute(&buf, map[string]any{"Orders": orders}); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// formatNumber — 1 234,50 (разделитель групп — неразрывный пробел, как Формат ЧДЦ=2 в 1С).
func formatNumber(x float64, dec int) string {
	s := fmt.Sprintf("%.*f", dec, x)
	intPart, frac := s, ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, frac = s[:i], s[i+1:]
	}
	neg := strings.HasPrefix(intPart, "-")
	intPart = strings.TrimPrefix(intPart, "-")
	var b strings.Builder
	for i, r := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteRune(' ')
		}
		b.WriteRune(r)
	}
	out := b.String()
	if neg {
		out = "-" + out
	}
	if frac != "" {
		out += "," + frac
	}
	return out
}
