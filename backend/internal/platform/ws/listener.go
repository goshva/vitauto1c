// Package ws — listener pg_notify: vitauto_notices (уведомления) и vitauto_changes (сигналы инвалидации).
package ws

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
)

// Listener читает pg_notify и передаёт события в hub.
type Listener struct {
	dsn string
	hub *Hub
}

// NewListener создаёт listener; dsn — строка подключения к vitauto_app (LISTEN требует выделенного соединения).
func NewListener(dsn string, hub *Hub) *Listener {
	return &Listener{dsn: dsn, hub: hub}
}

// Run — цикл подключения LISTEN/NOTIFY с переподключением при сбое.
func (l *Listener) Run(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		if err := l.listenOnce(ctx); err != nil && ctx.Err() == nil {
			log.Printf("[ws/listener] %v — переподключение через 2с", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
		}
	}
}

// listenOnce — одно выделенное соединение: LISTEN обоих каналов и приём уведомлений до ошибки/закрытия.
func (l *Listener) listenOnce(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, l.dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, "LISTEN vitauto_notices"); err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, "LISTEN vitauto_changes"); err != nil {
		return err
	}
	log.Printf("[ws/listener] LISTEN vitauto_notices, vitauto_changes")
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		switch n.Channel {
		case "vitauto_notices":
			l.hub.NotifyFromPg(n.Payload)
		case "vitauto_changes":
			l.hub.ChangeFromPg(n.Payload)
		}
	}
}
