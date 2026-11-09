package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"vitauto/backend/internal/arm"
	"vitauto/backend/internal/auth"
	"vitauto/backend/internal/teststand"
)

// ФТ п. 7 «Единый список незакрытого»: один список по всем заказам и отбор по полям.
func TestLinesFiltersAPI(t *testing.T) {
	ctx := context.Background()
	pool, err := teststand.Connect(ctx)
	if err != nil {
		t.Skipf("seed-стенд недоступен (%v): разверните seed/supplier-order-stand.ps1", err)
	}
	defer pool.Close()
	if err := teststand.Reset(ctx, pool); err != nil {
		t.Skipf("seed-стенд не готов: %v", err)
	}
	if err := teststand.PrepareFilterFixture(ctx, pool); err != nil {
		t.Fatal(err)
	}
	app := &App{
		ARM:  &arm.Service{DB: pool, Now: func() time.Time { return time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC) }},
		Auth: &auth.Service{DB: pool},
	}
	srv := httptest.NewServer(NewMux(pool, app))
	defer srv.Close()
	token := apiLogin(t, srv, teststand.ManagerLogin, teststand.ManagerPassword)

	ids := func(query string) map[string]bool {
		t.Helper()
		code, body := apiCall(t, srv, "GET", "/api/v1/lines?"+query, token, nil)
		if code != 200 {
			t.Fatalf("GET /lines?%s: код %d (%s)", query, code, body)
		}
		var page struct {
			Items      []map[string]any `json:"items"`
			NextCursor *string          `json:"nextCursor"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			t.Fatalf("ответ не разобран: %v (%s)", err, body)
		}
		got := map[string]bool{}
		for _, it := range page.Items {
			got[it["id"].(string)] = true
		}
		return got
	}
	for _, tc := range []struct {
		name  string
		query string
		want  []string
	}{
		{"продажи (вид по умолчанию)", "view=sales", []string{teststand.SaleLinked, teststand.SaleQtyDiff, teststand.SaleLinkedC}},
		{"закупки (удалённая скрыта)", "view=purchases", []string{teststand.PurchaseA, teststand.PurchaseB, teststand.PurchaseC, teststand.PurchaseNoSupplier, teststand.PurchaseUnmarked}},
		{"удалённая строка скрыта по умолчанию", "view=purchases", []string{teststand.PurchaseA, teststand.PurchaseB, teststand.PurchaseC, teststand.PurchaseNoSupplier, teststand.PurchaseUnmarked}},
		{"hideDeleted=false показывает удалённую", "view=purchases&hideDeleted=false", []string{teststand.PurchaseA, teststand.PurchaseB, teststand.PurchaseC, teststand.PurchaseNoSupplier, teststand.PurchaseUnmarked, teststand.PurchaseForeign}},
		{"hideShipped убирает отгруженные", "view=sales&hideShipped=true", []string{teststand.SaleLinked, teststand.SaleQtyDiff}},
		{"период по дате заказа", "view=sales&periodFrom=2026-11-20&periodTo=2026-11-20", []string{teststand.SaleQtyDiff}},
		{"заказ покупателя", "view=sales&customerOrderId=" + teststand.OrderID, []string{teststand.SaleLinked, teststand.SaleQtyDiff, teststand.SaleLinkedC}},
		{"№ заказа клиента", "view=sales&clientOrderNumber=ЗК-К-1", []string{teststand.SaleLinked}},
		{"артикул (факт)", "view=purchases&factArticle=ART-1", []string{teststand.PurchaseA}},
		{"склад", "view=purchases&warehouseId=" + teststand.MainWarehouse, []string{teststand.PurchaseA}},
		{"статус API-кодом", "view=sales&status=in_work", []string{teststand.SaleLinked, teststand.SaleQtyDiff}},
		{"комбинация отборов", "view=sales&hideShipped=true&periodFrom=2026-11-01&periodTo=2026-11-10", []string{teststand.SaleLinked}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := ids(tc.query)
			for _, id := range tc.want {
				if !got[id] {
					t.Errorf("%s: нет строки %s (получено %d: %v)", tc.query, id, len(got), got)
				}
			}
			if len(got) != len(tc.want) {
				t.Errorf("%s: строк %d, хотим %d (%v)", tc.query, len(got), len(tc.want), got)
			}
		})
	}
}
