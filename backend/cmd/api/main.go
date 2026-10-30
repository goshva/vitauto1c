// vitauto-api — HTTP + WebSocket сервер нового стека (план, раздел 3).
//
//	VITAUTO_ADDR=127.0.0.1:18100 VITAUTO_DB=postgres://postgres:***@localhost:5434/vitauto_app vitauto-api
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"vitauto/backend/internal/api"
	"vitauto/backend/internal/version"
)

func main() {
	addr := env("VITAUTO_ADDR", "127.0.0.1:18100")
	var db api.Pinger
	if dsn := os.Getenv("VITAUTO_DB"); dsn != "" {
		pool, err := pgxpool.New(context.Background(), dsn)
		if err != nil {
			log.Fatalf("база: %v", err)
		}
		defer pool.Close()
		db = pool
	}
	srv := &http.Server{Addr: addr, Handler: api.NewMux(db), ReadHeaderTimeout: 10 * time.Second}
	log.Printf("vitauto-api %s слушает %s", version.Version, addr)
	log.Fatal(srv.ListenAndServe())
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
