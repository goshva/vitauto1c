package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"vitauto/backend/internal/arm"
	"vitauto/backend/internal/auth"
)

// App — обработчики REST-контракта PWA (api/openapi.yaml) поверх arm.Service и auth.Service.
type App struct {
	ARM  *arm.Service
	Auth *auth.Service
}

type ctxKey int

const (
	actorKey ctxKey = iota
	sessionKey
)

func writeProblem(w http.ResponseWriter, err error) {
	p := arm.AsProblem(err)
	w.Header().Set("Content-Type", "application/problem+json; charset=utf-8")
	w.WriteHeader(p.Status)
	_ = json.NewEncoder(w).Encode(p)
}

func reply(w http.ResponseWriter, status int, v any, err error) {
	if err != nil {
		writeProblem(w, err)
		return
	}
	if status == http.StatusNoContent || v == nil && status != http.StatusOK {
		w.WriteHeader(status)
		return
	}
	writeJSON(w, status, v)
}

func body(r *http.Request, v any) error {
	if r.Body == nil || r.ContentLength == 0 {
		return nil
	}
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return &arm.Problem{Status: 400, Code: "bad_request", Message: "Тело запроса: " + err.Error()}
	}
	return nil
}

func query(r *http.Request) map[string]string {
	q := map[string]string{}
	for k, v := range r.URL.Query() {
		if len(v) > 0 {
			q[k] = v[0]
		}
	}
	return q
}

func actor(r *http.Request) arm.Actor { a, _ := r.Context().Value(actorKey).(arm.Actor); return a }

// authed — Bearer-токен сессии обязателен.
func (app *App) authed(h func(w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" || token == r.Header.Get("Authorization") {
			writeProblem(w, &arm.Problem{Status: 401, Code: "unauthorized", Message: "Нет сессии"})
			return
		}
		s, a, err := app.Auth.Resolve(r.Context(), token)
		if err != nil {
			writeProblem(w, err)
			return
		}
		ctx := context.WithValue(context.WithValue(r.Context(), actorKey, a), sessionKey, s)
		h(w, r.WithContext(ctx))
	}
}

// Register — маршруты /api/v1 контракта PWA.
func (app *App) Register(mux *http.ServeMux) {
	p := "/api/v1"
	h := func(pattern string, fn func(w http.ResponseWriter, r *http.Request)) {
		method, path, _ := strings.Cut(pattern, " ")
		mux.HandleFunc(method+" "+p+path, app.authed(fn))
	}
	mux.HandleFunc("POST "+p+"/session", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Login, Password string }
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		s, err := app.Auth.Login(r.Context(), b.Login, b.Password)
		reply(w, 201, s, err)
	})
	h("GET /session", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, r.Context().Value(sessionKey)) })
	h("DELETE /session", func(w http.ResponseWriter, r *http.Request) {
		s := r.Context().Value(sessionKey).(*auth.Session)
		reply(w, 204, nil, app.Auth.Logout(r.Context(), s.Token))
	})
	h("GET /matrix", func(w http.ResponseWriter, r *http.Request) {
		etag := arm.MatrixETag()
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", etag)
		writeJSON(w, 200, arm.MatrixFor(actor(r).Role))
	})

	// строки
	h("GET /lines", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.Lines(r.Context(), actor(r), query(r))
		reply(w, 200, v, err)
	})
	h("POST /lines", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			View, CustomerOrderID, SourceLineID string
			NomenclatureIDs                     []string
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.AddLines(r.Context(), actor(r), b.View, b.CustomerOrderID, b.SourceLineID, b.NomenclatureIDs)
		reply(w, 201, v, err)
	})
	h("POST /lines/transition", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ View, To string }
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.Transition(r.Context(), actor(r), b.View, b.To)
		reply(w, 200, v, err)
	})
	h("POST /lines/reject-assembly", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Reason string }
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.RejectAssembly(r.Context(), actor(r), b.Reason)
		reply(w, 200, v, err)
	})
	h("GET /lines/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.Line(r.Context(), actor(r), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("PATCH /lines/{id}", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Field string
			Value any
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.PatchLine(r.Context(), actor(r), r.PathValue("id"), b.Field, b.Value)
		reply(w, 200, v, err)
	})
	h("DELETE /lines/{id}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 204, nil, app.ARM.StrikeLine(r.Context(), actor(r), r.PathValue("id")))
	})
	h("POST /lines/{id}/mark", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.ToggleMark(r.Context(), actor(r), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("GET /selection", func(w http.ResponseWriter, r *http.Request) {
		view := r.URL.Query().Get("view")
		if view == "" {
			view = "sales"
		}
		v, err := app.ARM.Selection(r.Context(), actor(r), view)
		reply(w, 200, v, err)
	})
	h("POST /selection", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			View, CustomerOrderID string
			Marked                *bool
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.MarkOrder(r.Context(), actor(r), b.View, b.CustomerOrderID, b.Marked)
		reply(w, 200, v, err)
	})

	// продажи и снабжение
	h("POST /sales/jobs", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ AllowSplit bool }
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.InWork(r.Context(), actor(r), b.AllowSplit)
		reply(w, 202, v, err)
	})
	h("GET /jobs/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.GetJob(r.Context(), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("POST /sales/prepared", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.Prepared(r.Context(), actor(r))
		reply(w, 200, v, err)
	})
	h("POST /sales/shipments", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ CustomerOrderID, ShipmentDate, ShipmentNumber string }
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.Shipments(r.Context(), actor(r), b.CustomerOrderID, b.ShipmentDate, b.ShipmentNumber)
		reply(w, 200, v, err)
	})
	h("POST /sales/imports", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			CustomerID, ContractID string
			Rows                   []arm.ImportRow
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		if len(b.Rows) == 0 {
			writeProblem(w, &arm.Problem{Status: 400, Code: "bad_request", Message: "rows: непустой массив", Field: "rows"})
			return
		}
		v, err := app.ARM.CreateOrder(r.Context(), actor(r), b.CustomerID, b.ContractID, b.Rows[0].ClientNumber, "", b.Rows)
		reply(w, 201, v, err)
	})
	h("POST /sales/customer-orders", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ CustomerID, ContractID, ClientOrderNumber, Date string }
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.CreateOrder(r.Context(), actor(r), b.CustomerID, b.ContractID, b.ClientOrderNumber, b.Date, nil)
		reply(w, 201, v, err)
	})
	h("POST /sales/customer-orders/{id}/post", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.PostOrder(r.Context(), actor(r), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("DELETE /sales/customer-orders/{id}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 204, nil, app.ARM.DeleteOrder(r.Context(), actor(r), r.PathValue("id")))
	})
	h("POST /sales/supplier-orders", func(w http.ResponseWriter, r *http.Request) {
		writeProblem(w, &arm.Problem{Status: 501, Code: "not_supported", Message: "команда «Заказать» — через «В работе» (POST /sales/jobs)"})
	})
	h("POST /supply/status", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Status         string
			PartialReceipt bool
			ReceiptDate    string
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.Supply(r.Context(), actor(r), b.Status, b.PartialReceipt, b.ReceiptDate)
		reply(w, 200, v, err)
	})
	h("POST /print", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Kind             string
			CustomerOrderIDs []string
		}
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		html, err := app.ARM.Print(r.Context(), b.Kind, b.CustomerOrderIDs)
		reply(w, 200, map[string]string{"html": html}, err)
	})
	h("GET /notifications", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.Notices(r.Context(), actor(r))
		reply(w, 200, v, err)
	})
	h("POST /notifications/read", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ IDs []string }
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.ReadNotices(r.Context(), actor(r), b.IDs)
		reply(w, 200, v, err)
	})

	// документы и справочники
	h("GET /documents/{kind}/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.DocumentCard(r.Context(), r.PathValue("kind"), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("GET /directories/{name}", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.Directory(r.Context(), r.PathValue("name"), query(r))
		reply(w, 200, v, err)
	})
	catalog := func(kind string) bool { return kind == "goods" || kind == "services" || kind == "cars" }
	notFound := &arm.Problem{Status: 404, Code: "not_found", Message: "Раздел: goods, services, cars"}
	h("GET /catalog/{kind}", func(w http.ResponseWriter, r *http.Request) {
		if !catalog(r.PathValue("kind")) {
			writeProblem(w, notFound)
			return
		}
		v, err := app.ARM.CatalogList(r.Context(), actor(r), r.PathValue("kind"), query(r))
		reply(w, 200, v, err)
	})
	h("POST /catalog/{kind}", func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		if err := body(r, &b); err != nil || !catalog(r.PathValue("kind")) {
			writeProblem(w, firstErr(err, notFound))
			return
		}
		v, err := app.ARM.CatalogSave(r.Context(), actor(r), r.PathValue("kind"), "", b)
		reply(w, 201, v, err)
	})
	h("GET /catalog/{kind}/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.CatalogItem(r.Context(), r.PathValue("kind"), r.PathValue("id"))
		reply(w, 200, v, err)
	})
	h("PATCH /catalog/{kind}/{id}", func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := app.ARM.CatalogSave(r.Context(), actor(r), r.PathValue("kind"), r.PathValue("id"), b)
		reply(w, 200, v, err)
	})
	h("DELETE /catalog/{kind}/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.CatalogDelete(r.Context(), actor(r), r.PathValue("kind"), r.PathValue("id"), false)
		reply(w, 200, v, err)
	})
	h("POST /catalog/{kind}/{id}/restore", func(w http.ResponseWriter, r *http.Request) {
		v, err := app.ARM.CatalogDelete(r.Context(), actor(r), r.PathValue("kind"), r.PathValue("id"), true)
		reply(w, 200, v, err)
	})
}

func firstErr(errs ...error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}
