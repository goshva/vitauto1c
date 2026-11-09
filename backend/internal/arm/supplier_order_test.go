package arm

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"vitauto/backend/internal/teststand"
)

// ── без базы: проверки, которые возвращаются до обращения к БД ───────────────

func TestSupplierOrderRoleGate(t *testing.T) {
	// ФТ п. 5: заказ поставщику оформляют снабжение, менеджер и администратор; кладовщик — нет.
	// Отказ по роли возвращается до обращения к базе, поэтому Service без DB здесь достаточно.
	svc := &Service{}
	ctx := context.Background()
	for _, tc := range []struct{ name, role string }{
		{"кладовщик", "storekeeper"},
		{"главный механик", "chief_mechanic"},
		{"поставщик", "supplier"},
		{"клиент", "client"},
		{"без роли", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.SupplierOrder(ctx, Actor{UserID: mustUUID(t, teststand.StorekeeperUser), UserName: "X", Role: tc.role}, []string{teststand.PurchaseA})
			requireProblem(t, err, 403, "matrix_denied")
		})
	}
}

func TestSupplierOrderRequestValidation(t *testing.T) {
	svc := &Service{}
	ctx := context.Background()
	a := supplyActor(t)
	for _, tc := range []struct {
		name string
		ids  []string
	}{
		{"пустой список", nil},
		{"пустой элемент", []string{""}},
		{"не uuid", []string{"не-uuid"}},
		{"uuid и мусор", []string{teststand.PurchaseA, "abc"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.SupplierOrder(ctx, a, tc.ids)
			requireProblem(t, err, 400, "bad_request")
		})
	}
}

func TestSupplierOrderNeedsUser(t *testing.T) {
	svc := &Service{}
	_, err := svc.SupplierOrder(context.Background(), Actor{Role: "supply"}, []string{teststand.PurchaseA})
	requireProblem(t, err, 409, "not_author")
}

func supplyActor(t *testing.T) Actor {
	t.Helper()
	return Actor{UserID: mustUUID(t, teststand.SupplyUser), UserName: teststand.SupplyLogin, Login: teststand.SupplyLogin, Role: "supply"}
}

func mustUUID(t *testing.T, s string) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("uuid %q: %v", s, err)
	}
	return id
}

func requireProblem(t *testing.T, err error, status int, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("ожидалась ошибка %d %s, получили nil", status, code)
	}
	p := AsProblem(err)
	if p.Status != status || p.Code != code {
		t.Fatalf("получили %d %s (%s), хотим %d %s", p.Status, p.Code, p.Message, status, code)
	}
}

// ── на seed-стенде ───────────────────────────────────────────────────────────

// TestSupplierOrderByMarkedPurchases — happy path и ветки отказа по seed/supplier-order-stand.sql.
func TestSupplierOrderByMarkedPurchases(t *testing.T) {
	ctx := context.Background()
	pool, err := teststand.Connect(ctx)
	if err != nil {
		t.Skipf("seed-стенд недоступен (%v): разверните seed/supplier-order-stand.ps1 или задайте VITAUTO_SO_DSN", err)
	}
	defer pool.Close()
	if err := teststand.Reset(ctx, pool); err != nil {
		t.Skipf("seed-стенд не готов: %v", err)
	}

	svc := &Service{DB: pool, Now: func() time.Time { return time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC) }}
	a := supplyActor(t)

	refs, err := svc.SupplierOrder(ctx, a, []string{teststand.PurchaseA, teststand.PurchaseB, teststand.PurchaseC})
	if err != nil {
		t.Fatalf("SupplierOrder: %v", err)
	}
	// АвтооптТорг (A+B) и ДеталиОпт (C) — один заказ на пару «поставщик + договор + заказ покупателя»
	if len(refs) != 2 {
		t.Fatalf("документов = %d, хотим 2: %+v", len(refs), refs)
	}
	for _, r := range refs {
		if r.Kind != "supplier_order" || !r.Posted || r.Number == "" {
			t.Errorf("ссылка на документ неполная: %+v", r)
		}
		if r.Date != "2026-11-09" {
			t.Errorf("дата документа %q, хотим 2026-11-09", r.Date)
		}
	}

	// закупки: «Заказано», отметка снята, привязан заказ поставщику, заполнена дата заказа
	byLine := map[string]uuid.UUID{}
	for _, id := range []string{teststand.PurchaseA, teststand.PurchaseB, teststand.PurchaseC} {
		st := loadLineState(t, ctx, pool, id)
		if st.status != stOrdered {
			t.Errorf("закупка %s: статус %q, хотим %q", id, st.status, stOrdered)
		}
		if st.marked || st.markedBy != nil {
			t.Errorf("закупка %s: отметка не снята", id)
		}
		if st.supplierOrder == nil {
			t.Errorf("закупка %s: не привязан заказ поставщику", id)
			continue
		}
		if st.supplierOrderDate == nil {
			t.Errorf("закупка %s: не заполнена дата заказа поставщику", id)
		}
		byLine[id] = *st.supplierOrder
	}
	if byLine[teststand.PurchaseA] != byLine[teststand.PurchaseB] {
		t.Errorf("A и B одного поставщика+договора+заказа должны попасть в один документ")
	}
	if byLine[teststand.PurchaseA] == byLine[teststand.PurchaseC] {
		t.Errorf("C (другой поставщик и договор) должен попасть в отдельный документ")
	}

	// связанные продажи: тот же ключ и количество -> «Заказано»; количество другое -> без изменений
	if st := loadLineState(t, ctx, pool, teststand.SaleLinked); st.status != stOrdered || st.supplierOrder == nil {
		t.Errorf("связанная продажа %s: статус %q, заказ %v; хотим «Заказано» с заказом", teststand.SaleLinked, st.status, st.supplierOrder)
	}
	if st := loadLineState(t, ctx, pool, teststand.SaleLinkedC); st.status != stOrdered || st.supplierOrder == nil {
		t.Errorf("связанная продажа %s: статус %q, заказ %v; хотим «Заказано» с заказом", teststand.SaleLinkedC, st.status, st.supplierOrder)
	}
	if st := loadLineState(t, ctx, pool, teststand.SaleQtyDiff); st.status != stInWork || st.supplierOrder != nil {
		t.Errorf("продажа с другим количеством %s изменилась: статус %q, заказ %v", teststand.SaleQtyDiff, st.status, st.supplierOrder)
	}

	// документы: поставщик, договор, заказ покупателя, состав и проведение
	assertSupplierOrders(t, ctx, pool, refs, byLine)

	// повтор по уже заказанным строкам — 409 (заказ создаётся только по отметкам текущего пользователя)
	_, err = svc.SupplierOrder(ctx, a, []string{teststand.PurchaseA})
	requireProblem(t, err, 409, "nothing_marked")

	// закупка без поставщика — 409 validation (вся пачка откатывается)
	_, err = svc.SupplierOrder(ctx, a, []string{teststand.PurchaseNoSupplier})
	requireProblem(t, err, 409, "validation")

	// чужая отметка и отсутствие отметки — 409 nothing_marked
	_, err = svc.SupplierOrder(ctx, a, []string{teststand.PurchaseForeign})
	requireProblem(t, err, 409, "nothing_marked")
	_, err = svc.SupplierOrder(ctx, a, []string{teststand.PurchaseUnmarked})
	requireProblem(t, err, 409, "nothing_marked")

	// смешанный выбор: валидная строка + строка без отметки — команда целиком не выполняется
	_, err = svc.SupplierOrder(ctx, a, []string{teststand.PurchaseUnmarked, teststand.PurchaseNoSupplier})
	requireProblem(t, err, 409, "nothing_marked")
}

func assertSupplierOrders(t *testing.T, ctx context.Context, pool *pgxpool.Pool, refs []DocRef, byLine map[string]uuid.UUID) {
	t.Helper()
	items := map[uuid.UUID]int{}
	for _, r := range refs {
		var supplier, contract, order *uuid.UUID
		var posted bool
		var total float64
		if err := pool.QueryRow(ctx, `select counterparty_id, contract_id, customer_order_id, coalesce(posted,false), coalesce(total,0)
			from doc.supplier_order where id = $1`, r.ID).Scan(&supplier, &contract, &order, &posted, &total); err != nil {
			t.Fatalf("документ %s: %v", r.ID, err)
		}
		if !posted {
			t.Errorf("документ %s не проведён", r.ID)
		}
		if supplier == nil || contract == nil {
			t.Errorf("документ %s: не заполнены поставщик/договор", r.ID)
		}
		if order == nil || order.String() != teststand.OrderID {
			t.Errorf("документ %s: заказ покупателя %v, хотим %s", r.ID, order, teststand.OrderID)
		}
		var n int
		var sum float64
		if err := pool.QueryRow(ctx, `select count(*), coalesce(sum(total),0) from doc.supplier_order_item
			where doc_id = $1 and not coalesce(deleted,false)`, r.ID).Scan(&n, &sum); err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			t.Errorf("документ %s без позиций", r.ID)
		}
		if total != sum {
			t.Errorf("документ %s: СуммаДокумента %v ≠ сумме позиций %v", r.ID, total, sum)
		}
		items[r.ID] = n
		if err := pool.QueryRow(ctx, `select count(*) from integration.outbox where entity = 'supplier_order' and entity_id = $1`, r.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			t.Errorf("документ %s не попал в outbox", r.ID)
		}
	}
	// 2 закупки АвтооптТорга + 1 ДеталиОпта = 3 позиции на два документа
	if got := items[byLine[teststand.PurchaseA]]; got != 2 {
		t.Errorf("в документе АвтооптТорга позиций %d, хотим 2", got)
	}
	if got := items[byLine[teststand.PurchaseC]]; got != 1 {
		t.Errorf("в документе ДеталиОпта позиций %d, хотим 1", got)
	}
}

type lineState struct {
	status            string
	marked            bool
	markedBy          *uuid.UUID
	supplierOrder     *uuid.UUID
	supplierOrderDate *time.Time
}

func loadLineState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) lineState {
	t.Helper()
	var st lineState
	if err := pool.QueryRow(ctx, `select status, coalesce(marked,false), marked_by_id, supplier_order_id, supplier_order_date
		from arm.line where id = $1`, id).Scan(&st.status, &st.marked, &st.markedBy, &st.supplierOrder, &st.supplierOrderDate); err != nil {
		t.Fatalf("строка %s: %v", id, err)
	}
	return st
}
