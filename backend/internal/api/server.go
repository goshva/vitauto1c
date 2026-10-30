// Package api — HTTP-слой vitauto-api: REST /api/v1 по api/openapi.yaml (копия openapi.yaml рядом создаётся `task gen`),
// Swagger UI на /api/docs. Типы запросов и ответов — types.gen.go (oapi-codegen); обработчики добавляются по этапам плана.
package api

import (
	"context"
	_ "embed"
	"encoding/json"
	"net/http"
	"time"

	"vitauto/backend/internal/version"
)

//go:embed openapi.yaml
var openapiYAML []byte

//go:embed asyncapi.yaml
var asyncapiYAML []byte

// Pinger — проверка доступности базы для /health (nil — база не настроена).
type Pinger interface {
	Ping(ctx context.Context) error
}

// NewMux собирает маршруты сервиса.
func NewMux(db Pinger) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		h := Health{Status: HealthStatusOk, Version: version.Version}
		if db != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			st := HealthDatabaseOk
			if err := db.Ping(ctx); err != nil {
				st, h.Status = HealthDatabaseUnavailable, HealthStatusDegraded
			}
			h.Database = &st
		}
		writeJSON(w, http.StatusOK, h)
	})
	mux.HandleFunc("GET /api/v1/openapi.yaml", serveYAML(openapiYAML))
	mux.HandleFunc("GET /api/v1/asyncapi.yaml", serveYAML(asyncapiYAML))
	mux.HandleFunc("GET /api/docs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(swaggerPage))
	})
	return mux
}

func serveYAML(b []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
		_, _ = w.Write(b)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Swagger UI с jsDelivr (точная версия); спецификация — с этого же сервера.
const swaggerPage = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>vitauto-api — Swagger</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css">
</head><body><div id="ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/v1/openapi.yaml', dom_id: '#ui', deepLinking: true });</script>
</body></html>`
