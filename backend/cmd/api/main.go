// vitauto-api — HTTP + WebSocket сервер нового стека (план, раздел 3).
//
//	VITAUTO_ADDR=127.0.0.1:18100 VITAUTO_DB=postgres://postgres:***@localhost:5434/vitauto_app vitauto-api
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"vitauto/backend/internal/api"
	"vitauto/backend/internal/application"
	"vitauto/backend/internal/arm"
	"vitauto/backend/internal/auth"
	"vitauto/backend/internal/integration"
	"vitauto/backend/internal/platform/ws"
	"vitauto/backend/internal/version"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	addr := env("VITAUTO_ADDR", "127.0.0.1:18100")
	var db api.Pinger
	var app *api.App
	if dsn := os.Getenv("VITAUTO_DB"); dsn != "" {
		pool, err := pgxpool.New(ctx, dsn)
		if err != nil {
			log.Fatalf("база: %v", err)
		}
		defer pool.Close()
		db = pool
		hub := ws.NewHub()
		go ws.NewListener(dsn, hub).Run(ctx)
		app = &api.App{
			ARM:  &arm.Service{DB: pool},
			Auth: &auth.Service{DB: pool},
			Apps: &application.Service{DB: pool},
			WS:   hub,
		}
		// Очередь документов в 1С: воркер стартует только при настроенной публикации,
		// иначе записи integration.outbox остаются со статусом 'new' (не теряются).
		if onecURL := os.Getenv("VITAUTO_1C_URL"); onecURL != "" {
			ob := &integration.Outbox{
				DB:       pool,
				BaseURL:  onecURL,
				User:     os.Getenv("VITAUTO_1C_USER"),
				Password: os.Getenv("VITAUTO_1C_PASS"),
			}
			if d, err := time.ParseDuration(env("VITAUTO_1C_INTERVAL", "")); err == nil && d > 0 {
				ob.Interval = d
			}
			go ob.Run(ctx)
		} else {
			log.Print("[outbox] VITAUTO_1C_URL не задан — очередь 1С не обрабатывается")
		}
	}
	srv := &http.Server{Addr: addr, Handler: api.NewMux(db, app), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
	}()
	log.Printf("vitauto-api %s слушает %s", version.Version, addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
