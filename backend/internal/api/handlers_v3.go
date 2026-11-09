// handlers_v3.go — справочник брендов, кросс-коды и вложения карточек (ТЗ 2.1/2.2).
package api

import (
	"io"
	"net/http"
	"strings"

	"vitauto/backend/internal/arm"
)

// RegisterV3 — маршруты карточки номенклатуры: бренды и фото.
func (a *App) RegisterV3(mux *http.ServeMux) {
	p := "/api/v1"

	h := func(pattern string, fn func(w http.ResponseWriter, r *http.Request)) {
		method, path, _ := strings.Cut(pattern, " ")
		mux.HandleFunc(method+" "+p+path, a.authed(fn))
	}

	// GET /directories/brands обслуживается общим GET /directories/{name}.

	// ─── Бренды (ТЗ 2.2) ───
	h("POST /brands", func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := a.ARM.BrandSave(r.Context(), actor(r), "", b)
		reply(w, 201, v, err)
	})
	h("PATCH /brands/{id}", func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		if err := body(r, &b); err != nil {
			writeProblem(w, err)
			return
		}
		v, err := a.ARM.BrandSave(r.Context(), actor(r), r.PathValue("id"), b)
		reply(w, 200, v, err)
	})
	h("DELETE /brands/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.ARM.BrandDelete(r.Context(), actor(r), r.PathValue("id"), false)
		reply(w, 200, v, err)
	})
	h("POST /brands/{id}/restore", func(w http.ResponseWriter, r *http.Request) {
		v, err := a.ARM.BrandDelete(r.Context(), actor(r), r.PathValue("id"), true)
		reply(w, 200, v, err)
	})

	// ─── Вложения: фото номенклатуры и неопознанных (ТЗ 2.1) ───
	h("GET /attachments", func(w http.ResponseWriter, r *http.Request) {
		q := query(r)
		v, err := a.ARM.AttachmentList(r.Context(), q["ownerType"], q["ownerId"])
		reply(w, 200, v, err)
	})
	h("POST /attachments", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
		if err := r.ParseMultipartForm(6 << 20); err != nil {
			writeProblem(w, &arm.Problem{Status: 400, Code: "bad_request", Message: "Ожидается multipart/form-data с полем file"})
			return
		}
		f, hdr, err := r.FormFile("file")
		if err != nil {
			writeProblem(w, &arm.Problem{Status: 400, Code: "bad_request", Message: "Файл не передан (поле file)"})
			return
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, 5<<20+1))
		if err != nil {
			writeProblem(w, &arm.Problem{Status: 400, Code: "bad_request", Message: "Не удалось прочитать файл"})
			return
		}
		ct := hdr.Header.Get("Content-Type")
		if ct == "" {
			ct = http.DetectContentType(data)
		}
		v, err := a.ARM.AttachmentCreate(r.Context(), actor(r), r.FormValue("ownerType"), r.FormValue("ownerId"), hdr.Filename, ct, data)
		reply(w, 201, v, err)
	})
	h("DELETE /attachments/{id}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 204, nil, a.ARM.AttachmentDelete(r.Context(), actor(r), r.PathValue("id")))
	})

	// GET /attachments/{id} — отдача файла для <img>: токен можно передать ?token=,
	// потому что тег <img> не умеет заголовок Authorization.
	mux.HandleFunc("GET "+p+"/attachments/{id}", func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			token = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		}
		if token == "" || token == r.Header.Get("Authorization") || a.Auth == nil {
			writeProblem(w, &arm.Problem{Status: 401, Code: "unauthorized", Message: "Нет сессии"})
			return
		}
		if _, _, err := a.Auth.Resolve(r.Context(), token); err != nil {
			writeProblem(w, err)
			return
		}
		data, ct, name, err := a.ARM.AttachmentRead(r.Context(), r.PathValue("id"))
		if err != nil {
			writeProblem(w, err)
			return
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Content-Disposition", `inline; filename="`+strings.ReplaceAll(name, `"`, "")+`"`)
		w.Header().Set("Cache-Control", "private, max-age=300")
		_, _ = w.Write(data)
	})
}
