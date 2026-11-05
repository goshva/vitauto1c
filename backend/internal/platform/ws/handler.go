// Package ws — HTTP handler для WebSocket-подключений.
package ws

import (
	"log"
	"net/http"

	"github.com/coder/websocket"
)

// Handler возвращает http.HandlerFunc, принимающий WS-подключения.
// resolveRole извлекает роль пользователя из запроса (аутентификацию выполняет вызывающая сторона —
// api-слой проверяет Bearer-токен и возвращает роль; пустая строка — отказ).
func Handler(hub *Hub, resolveRole func(r *http.Request) string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := resolveRole(r)
		if role == "" {
			http.Error(w, `{"code":"unauthorized","message":"нужна сессия"}`, http.StatusUnauthorized)
			return
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true, // dev: Vite 5173 → API 18100; продакшн — один origin
		})
		if err != nil {
			log.Printf("[ws/accept] %v", err)
			return
		}
		hub.NewClient(conn, role)
	}
}
