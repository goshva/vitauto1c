package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"vitauto/backend/internal/arm"
	"vitauto/backend/internal/auth"
	"vitauto/backend/internal/teststand"
)

// TestSupplierOrderAPI — HTTP-контракт POST /sales/supplier-orders поверх seed-стенда:
// 401 без сессии, 400 на пустой/битый lineIds, 403 кладовщику, 201 и массив DocumentRef снабженцу,
// строка в ответе GET /lines/{id} переходит в статус API «ordered» со снятой отметкой.
func TestSupplierOrderAPI(t *testing.T) {
	ctx := context.Background()
	pool, err := teststand.Connect(ctx)
	if err != nil {
		t.Skipf("seed-стенд недоступен (%v): разверните seed/supplier-order-stand.ps1 или задайте VITAUTO_SO_DSN", err)
	}
	defer pool.Close()
	if err := teststand.Reset(ctx, pool); err != nil {
		t.Skipf("seed-стенд не готов: %v", err)
	}

	app := &App{
		ARM:  &arm.Service{DB: pool, Now: func() time.Time { return time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC) }},
		Auth: &auth.Service{DB: pool},
	}
	srv := httptest.NewServer(NewMux(pool, app))
	defer srv.Close()

	path := "/api/v1/sales/supplier-orders"

	// без сессии — 401
	if code, body := apiCall(t, srv, "POST", path, "", map[string]any{"lineIds": []string{teststand.PurchaseA}}); code != 401 {
		t.Fatalf("без токена: код %d (%s), хотим 401", code, body)
	}

	supply := apiLogin(t, srv, teststand.SupplyLogin, teststand.SupplyPassword)

	// невалидное тело — 400
	for _, tc := range []struct {
		name string
		body any
	}{
		{"пустой список", map[string]any{"lineIds": []string{}}},
		{"нет поля", map[string]any{}},
		{"не uuid", map[string]any{"lineIds": []string{"не-uuid"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, body := apiCall(t, srv, "POST", path, supply, tc.body)
			requireAPIProblem(t, code, body, 400, "bad_request")
		})
	}

	// кладовщик — 403 (ФТ п. 5)
	storekeeper := apiLogin(t, srv, teststand.StorekeeperLogin, teststand.StorekeeperPassword)
	code, body := apiCall(t, srv, "POST", path, storekeeper, map[string]any{"lineIds": []string{teststand.PurchaseA}})
	requireAPIProblem(t, code, body, 403, "matrix_denied")

	// снабженец — 201, массив DocumentRef
	code, body = apiCall(t, srv, "POST", path, supply, map[string]any{"lineIds": []string{teststand.PurchaseA}})
	if code != 201 {
		t.Fatalf("создание: код %d (%s), хотим 201", code, body)
	}
	var refs []struct {
		ID     string `json:"id"`
		Kind   string `json:"kind"`
		Number string `json:"number"`
		Date   string `json:"date"`
		Posted bool   `json:"posted"`
	}
	if err := json.Unmarshal(body, &refs); err != nil {
		t.Fatalf("ответ не разобран как массив DocumentRef: %v (%s)", err, body)
	}
	if len(refs) != 1 || refs[0].Kind != "supplier_order" || refs[0].ID == "" || refs[0].Number == "" || !refs[0].Posted {
		t.Fatalf("неверный DocumentRef: %+v", refs)
	}

	// GET /lines/{id}: статус API и привязка заказа поставщику
	code, body = apiCall(t, srv, "GET", "/api/v1/lines/"+teststand.PurchaseA, supply, nil)
	if code != 200 {
		t.Fatalf("GET /lines/%s: код %d (%s)", teststand.PurchaseA, code, body)
	}
	var line struct {
		Status   string `json:"status"`
		Marked   bool   `json:"marked"`
		Supplier *struct {
			ID string `json:"id"`
		} `json:"supplierOrder"`
	}
	if err := json.Unmarshal(body, &line); err != nil {
		t.Fatalf("строка не разобрана: %v (%s)", err, body)
	}
	if line.Status != "ordered" {
		t.Errorf("статус строки %q, хотим ordered", line.Status)
	}
	if line.Marked {
		t.Errorf("отметка строки не снята")
	}
	if line.Supplier == nil || line.Supplier.ID != refs[0].ID {
		t.Errorf("строка не привязана к созданному заказу поставщику: %+v", line.Supplier)
	}

	// повтор по уже заказанной строке — 409
	code, body = apiCall(t, srv, "POST", path, supply, map[string]any{"lineIds": []string{teststand.PurchaseA}})
	requireAPIProblem(t, code, body, 409, "nothing_marked")
}

func apiLogin(t *testing.T, srv *httptest.Server, login, password string) string {
	t.Helper()
	code, body := apiCall(t, srv, "POST", "/api/v1/session", "", map[string]string{"login": login, "password": password})
	if code != 201 {
		t.Fatalf("вход %s: код %d (%s)", login, code, body)
	}
	var s struct {
		Token string `json:"token"`	
	}
	if err := json.Unmarshal(body, &s); err != nil || s.Token == "" {
		t.Fatalf("вход %s: нет токена в ответе (%s)", login, body)
	}
	return s.Token
}

func apiCall(t *testing.T, srv *httptest.Server, method, path, token string, body any) (int, []byte) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, out
}

func requireAPIProblem(t *testing.T, code int, body []byte, wantStatus int, wantCode string) {
	t.Helper()
	if code != wantStatus {
		t.Fatalf("код %d (%s), хотим %d", code, body, wantStatus)
	}
	var p struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("problem+json не разобран: %v (%s)", err, body)
	}
	if p.Code != wantCode {
		t.Fatalf("код ошибки %q, хотим %q (%s)", p.Code, wantCode, body)
	}
}
