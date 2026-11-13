// handlers_v2.go — новые REST-маршруты для фич из плана реализации (возвраты, доступ, самовывоз, неопознанные, workshop).
// Все маршруты проходят авторизацию через authed-обёртку.
package api

import (
	"io"
	"net/http"
	"strings"

	"vitauto/backend/internal/application"
	"vitauto/backend/internal/arm"
	"vitauto/backend/internal/domain"
	"vitauto/backend/internal/platform/ws"
)

// RegisterV2 — маршруты для новых фич (C1/C2, M13→A3, N4, M18/A1/K8, G1–G9).
func (a *App) RegisterV2(mux *http.ServeMux) {
	p := "/api/v1"

	h := func(pattern string, fn func(w http.ResponseWriter, r *http.Request)) {
		method, path, _ := strings.Cut(pattern, " ")
		mux.HandleFunc(method+" "+p+path, a.authed(fn))
	}

	// ——— Возвраты (M16, K6, C1/C2) ———
	h("GET /returns", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.Apps.ReturnList(r.Context(), domainActor(r))
		reply(w, 200, v, err)
	})
	h("GET /returns/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.Apps.ReturnDetail(r.Context(), domainActor(r), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("POST /returns", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Operation string                   `json:"operation"`
			OrderID   string                   `json:"orderId"`
			Lines     []application.ReturnLine `json:"lines"`
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		op := a.resolveOp(b.Operation)
		v, err := a.Apps.ReturnCreate(r.Context(), domainActor(r), op, b.OrderID, b.Lines)
		reply(w, 201, v, err)
	})
	h("POST /returns/{id}/post", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.Apps.ReturnPost(r.Context(), domainActor(r), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("POST /returns/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 204, nil, a.Apps.ReturnCancel(r.Context(), domainActor(r), r.PathValue("id")))
	})

	// ——— Доступ (M13 → A3) ———
	h("GET /access-requests", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.Apps.AccessRequestList(r.Context(), domainActor(r))
		reply(w, 200, v, err)
	})
	h("GET /access-requests/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.Apps.AccessRequestDetail(r.Context(), domainActor(r), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("POST /access-requests", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Action  string         `json:"action"`
			LineID  string         `json:"lineId,omitempty"`
			Payload map[string]any `json:"payload"`
			Reason  string         `json:"reason"`
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := a.Apps.AccessRequestCreate(r.Context(), domainActor(r), b.Action, b.LineID, b.Payload, b.Reason)
		reply(w, 201, v, err)
	})
	h("POST /access-requests/{id}/decide", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Approved bool
			Note     string
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		reply(w, 204, nil, a.Apps.AccessRequestDecide(r.Context(), domainActor(r), r.PathValue("id"), b.Approved, b.Note))
	})

	// ——— Самовывоз (N4) ———
	h("POST /lines/{id}/self-pickup", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 204, nil, a.Apps.SelfPickupSet(r.Context(), domainActor(r), r.PathValue("id")))
	})

	// ——— Импорт листа покупателя из файла (M1, ТЧИ1) ———
	// multipart: file (.xlsx/.csv) + customerId, contractId — тот же CreateOrder, что POST /sales/imports.
	h("POST /sales/imports/file", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			writeProblem(w, &arm.Problem{Status: 400, Code: "bad_request", Message: "multipart: file, customerId", Field: "file"})
			return
		}
		file, head, err := r.FormFile("file")
		if err != nil {
			writeProblem(w, &arm.Problem{Status: 400, Code: "bad_request", Message: "Нужен файл поля file (.xlsx/.csv)", Field: "file"})
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, 32<<20))
		if err != nil {
			writeProblem(w, err)
			return
		}
		parsed, err := application.ParseImportSheet(head.Filename, data)
		if err != nil {
			writeProblem(w, err)
			return
		}
		v, err := a.ARM.CreateOrder(r.Context(), actor(r), r.FormValue("customerId"), r.FormValue("contractId"),
			firstClientNumber(parsed.Rows), "", parsed.Rows)
		if err != nil {
			writeProblem(w, err)
			return
		}
		reply(w, 201, map[string]any{"doc": v, "warnings": parsed.Warnings}, nil)
	})

	// ——— Размещение по ячейкам (K2) ———
	h("GET /cells", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.Apps.Cells(r.Context(), domainActor(r), r.URL.Query().Get("warehouseId"))
		reply(w, 200, v, err)
	})
	h("POST /lines/{id}/cell", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			CellID string `json:"cellId"`
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := a.Apps.PlaceCell(r.Context(), domainActor(r), r.PathValue("id"), b.CellID)
		reply(w, 200, v, err)
	})

	// ——— Неопознанные (M18/A1/K8) ———
	h("GET /unidentified", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.Apps.UnidentifiedList(r.Context(), domainActor(r))
		reply(w, 200, v, err)
	})
	h("GET /unidentified/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.Apps.UnidentifiedDetail(r.Context(), domainActor(r), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("POST /unidentified", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			LineID    string   `json:"lineId,omitempty"`
			FactName  string   `json:"factName"`
			PhotoURLs []string `json:"photoUrls"`
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := a.Apps.UnidentifiedCreate(r.Context(), domainActor(r), b.LineID, b.FactName, b.PhotoURLs)
		reply(w, 201, v, err)
	})
	h("POST /unidentified/{id}/link", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ NomenclatureID string }
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		reply(w, 204, nil, a.Apps.UnidentifiedLink(r.Context(), domainActor(r), r.PathValue("id"), b.NomenclatureID))
	})
	h("POST /unidentified/{id}/found", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 204, nil, a.Apps.UnidentifiedFound(r.Context(), domainActor(r), r.PathValue("id")))
	})

	// ——— Workshop (G1–G9) ———
	h("GET /work-orders", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.Apps.WorkOrderList(r.Context(), domainActor(r))
		reply(w, 200, v, err)
	})
	h("GET /work-orders/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.Apps.WorkOrderDetail(r.Context(), domainActor(r), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("POST /work-orders", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			CarID      string                      `json:"carId,omitempty"`
			CustomerID string                      `json:"customerId,omitempty"`
			OrderID    string                      `json:"orderId,omitempty"`
			Lines      []application.WorkOrderLine `json:"lines"`
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := a.Apps.WorkOrderCreate(r.Context(), domainActor(r), b.CarID, b.CustomerID, b.OrderID, b.Lines)
		reply(w, 201, v, err)
	})
	h("POST /work-orders/{id}/release", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 204, nil, a.Apps.WorkOrderRelease(r.Context(), domainActor(r), r.PathValue("id")))
	})

	// ——— WebSocket ———
	// Браузер не может задать заголовок на WebSocket — токен принимается и в query-параметре token.
	mux.HandleFunc("GET /api/v1/ws", func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" || token == r.Header.Get("Authorization") {
			token = r.URL.Query().Get("token")
		}
		if token == "" {
			writeProblem(w, &arm.Problem{Status: 401, Code: "unauthorized", Message: "Нет сессии"})
			return
		}
		_, a2, err := a.Auth.Resolve(r.Context(), token)
		if err != nil {
			writeProblem(w, err)
			return
		}
		role := a2.Role
		if role == "" {
			writeProblem(w, &arm.Problem{Status: 401, Code: "unauthorized", Message: "Нет роли в сессии"})
			return
		}
		handler := ws.Handler(a.WS, func(r *http.Request) string { return role })
		handler(w, r)
	})
}

// firstClientNumber — номер клиента из первой непустой строки листа (как в POST /sales/imports).
func firstClientNumber(rows []arm.ImportRow) string {
	for _, r := range rows {
		if r.ClientNumber != "" {
			return r.ClientNumber
		}
	}
	return ""
}

// resolveOp — значение 1С → domain.Operation.
func (a *App) resolveOp(op string) domain.Operation {
	switch op {
	case "sale", "Продажа":
		return domain.OpSale
	case "purchase", "Закупка":
		return domain.OpPurchase
	default:
		return domain.OpSale
	}
}

// domainActor — arm.Actor (сессия legacy) → domain.Actor (команды application).
func domainActor(r *http.Request) domain.Actor {
	x := actor(r)
	return domain.Actor{UserID: x.UserID, UserName: x.UserName, Login: x.Login, Role: domain.Role(x.Role)}
}
