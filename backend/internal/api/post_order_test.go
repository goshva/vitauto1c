package api

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"vitauto/backend/internal/arm"
	"vitauto/backend/internal/auth"
	"vitauto/backend/internal/teststand"
)

// ФТ п. 2: POST /sales/customer-orders/{id}/post не создаёт заказ поставщику (проверка на уровне API).
func TestPostOrderDoesNotCreateSupplierOrderAPI(t *testing.T) {
	ctx := context.Background()
	pool, err := teststand.Connect(ctx)
	if err != nil {
		t.Skipf("seed-стенд недоступен (%v): разверните seed/supplier-order-stand.ps1", err)
	}
	defer pool.Close()
	if err := teststand.Reset(ctx, pool); err != nil {
		t.Skipf("seed-стенд не готов: %v", err)
	}
	if err := teststand.PreparePostableSales(ctx, pool, teststand.ManagerUser); err != nil {
		t.Fatal(err)
	}
	app := &App{
		ARM:  &arm.Service{DB: pool, Now: func() time.Time { return time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC) }},
		Auth: &auth.Service{DB: pool},
	}
	srv := httptest.NewServer(NewMux(pool, app))
	defer srv.Close()
	token := apiLogin(t, srv, teststand.ManagerLogin, teststand.ManagerPassword)
	code, body := apiCall(t, srv, "POST", "/api/v1/sales/customer-orders/"+teststand.OrderID+"/post", token, nil)
	if code != 200 {
		t.Fatalf("проведение заказа: код %d (%s), хотим 200", code, body)
	}
	var so int
	if err := pool.QueryRow(ctx, "select count(*) from doc.supplier_order where base_doc_id = $1", teststand.OrderID).Scan(&so); err != nil {
		t.Fatal(err)
	}
	if so != 0 {
		t.Errorf("после проведения заказа появилось %d заказ(ов) поставщику — автосоздание должно быть отключено", so)
	}
}
