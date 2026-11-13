// Package ws — WebSocket hub для рассылки клиенту событий vitauto.
// Сигнальная система (asyncapi.yaml): сервер шлёт МИНИМАЛЬНЫЕ сообщения, клиент сам перезапрашивает API.
//   - notice  — новое уведомление (роль + узел, без полного текста)
//   - change  — инвалидация данных: {"e":"line","id":"...","op":"update"} → клиент обновит нужный GET
//   - resync  — клиенту пропущено слишком много, полная перезагрузка экрана
//   - ping    — keepalive
package ws

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/coder/websocket"

	"vitauto/backend/internal/domain"
)

// Message — формат полезной нагрузки WS.
type Message struct {
	Kind    string          `json:"kind"`              // notice, change, resync, ping, pong
	Topic   string          `json:"topic,omitempty"`   // M8, A3, ...
	Payload json.RawMessage `json:"payload,omitempty"` // минимальный: id/entity/roles, не данные
}

// Hub — центральный концентратор подключений.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*client]struct{} // role -> set
}

type client struct {
	conn   *websocket.Conn
	role   string
	ctx    context.Context
	cancel context.CancelFunc
	sendCh chan []byte
	closed chan struct{}
	// дебаунс сигналов change: одна инвалидация на entity за короткое окно —
	// пакетные команды (переход 50 строк) дают один сигнал, а не 50
	mu      sync.Mutex
	pending map[string]json.RawMessage // entity -> последний сигнал
	ptimer  *time.Timer
}

const changeDebounce = 300 * time.Millisecond

// NewHub создаёт hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]map[*client]struct{}),
	}
}

// NewClient создаёт новое WS-подключение и запускает цикл чтения/записи.
func (h *Hub) NewClient(conn *websocket.Conn, role string) {
	ctx, cancel := context.WithCancel(context.Background())
	c := &client{
		conn:    conn,
		role:    role,
		ctx:     ctx,
		cancel:  cancel,
		sendCh:  make(chan []byte, 64),
		closed:  make(chan struct{}),
		pending: map[string]json.RawMessage{},
	}

	h.mu.Lock()
	if h.clients[role] == nil {
		h.clients[role] = make(map[*client]struct{})
	}
	h.clients[role][c] = struct{}{}
	h.mu.Unlock()

	log.Printf("[ws] connected: role=%s total=%d", role, h.totalClients())
	defer func() {
		h.mu.Lock()
		delete(h.clients[role], c)
		h.mu.Unlock()
		c.mu.Lock()
		if c.ptimer != nil {
			c.ptimer.Stop()
		}
		c.mu.Unlock()
		cancel()
		close(c.closed)
		conn.CloseNow()
		log.Printf("[ws] disconnected: role=%s total=%d", role, h.totalClients())
	}()

	go h.readLoop(c)
	go h.writeLoop(c)
	<-c.closed
}

func (h *Hub) readLoop(c *client) {
	for {
		_, data, err := c.conn.Read(c.ctx)
		if err != nil {
			return
		}
		var m Message
		if err := json.Unmarshal(data, &m); err == nil {
			if m.Kind == "ping" {
				_ = sendMsg(c.ctx, c.conn, Message{Kind: "pong"})
			}
		}
	}
}

func (h *Hub) writeLoop(c *client) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.closed:
			return
		case <-ticker.C:
			_ = sendMsg(c.ctx, c.conn, Message{Kind: "ping"})
		case data, ok := <-c.sendCh:
			if !ok {
				return
			}
			if err := c.conn.Write(c.ctx, websocket.MessageText, data); err != nil {
				return
			}
		}
	}
}

func sendMsg(ctx context.Context, conn *websocket.Conn, msg Message) error {
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, b)
}

// enqueue — положить готовый JSON в очередь клиента (неблокирующе).
func enqueue(c *client, data []byte) {
	select {
	case c.sendCh <- data:
	default:
		// буфер полон — клиент отстал; просим полную перезагрузку экрана
		_ = sendMsg(c.ctx, c.conn, Message{Kind: "resync"})
	}
}

// Broadcast отправляет сообщение всем клиентам роли.
func (h *Hub) Broadcast(role string, data []byte) {
	h.mu.RLock()
	clients := h.clients[role]
	h.mu.RUnlock()
	for c := range clients {
		enqueue(c, data)
	}
}

// BroadcastAny — широковещательная отправка всем ролям.
func (h *Hub) BroadcastAny(data []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, clients := range h.clients {
		for c := range clients {
			enqueue(c, data)
		}
	}
}

// NotifyFromPg — pg_notify vitauto_notices: уведомление нужной роли.
// Роль в payload — имя роли 1С (Менеджер, Кладовщик …); приводим к API-роли.
// Минимальный размер: только noticeId + узел + вид, без текста (текст клиент возьмёт из GET /notifications).
func (h *Hub) NotifyFromPg(payload string) {
	var m map[string]any
	if err := json.Unmarshal([]byte(payload), &m); err != nil {
		return
	}
	role, _ := m["role"].(string)
	if api, ok := domain.RoleByEnum[role]; ok {
		role = string(api)
	}
	node, _ := m["node"].(string)
	noticeID, _ := m["noticeId"].(string)
	if role == "" || noticeID == "" {
		return
	}
	compact, err := json.Marshal(map[string]string{"noticeId": noticeID, "node": node})
	if err != nil {
		return
	}
	b, err := json.Marshal(Message{Kind: "notice", Topic: node, Payload: compact})
	if err != nil {
		return
	}
	h.Broadcast(role, b)
}

// ChangeFromPg — pg_notify vitauto_changes: СИГНАЛ инвалидации (asyncapi Change).
// payload: {"e":"line","id":"...","op":"update","roles":[...]} → клиент перезапросит нужный GET.
// Дебаунс changeDebounce на клиент: пакетные команды (50 строк) дают один батч-пакет, а не 50 сообщений.
func (h *Hub) ChangeFromPg(payload string) {
	var m struct {
		E     string   `json:"e"`
		ID    string   `json:"id"`
		Op    string   `json:"op"`
		Roles []string `json:"roles"`
	}
	if err := json.Unmarshal([]byte(payload), &m); err != nil || m.E == "" {
		return
	}
	sig, err := json.Marshal(signal{E: m.E, ID: m.ID, Op: m.Op})
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, role := range m.Roles {
		for c := range h.clients[role] {
			c.scheduleChange(m.E, sig)
		}
	}
}

// signal — минимальный сигнал инвалидации (без данных).
type signal struct {
	E  string `json:"e"`
	ID string `json:"id,omitempty"`
	Op string `json:"op,omitempty"`
}

// scheduleChange — дебаунс: последний сигнал на entity копится в pending,
// по истечении окна вся пачка уходит ОДНИМ сообщением {"kind":"change","payload":[...]}.
func (c *client) scheduleChange(entity string, sig json.RawMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pending == nil {
		c.pending = map[string]json.RawMessage{}
	}
	c.pending[entity] = sig // последний сигнал важнее предыдущего
	if c.ptimer == nil {
		c.ptimer = time.AfterFunc(changeDebounce, c.flushChanges)
	}
}

// flushChanges — отправить накопленные сигналы одним пакетом.
func (c *client) flushChanges() {
	c.mu.Lock()
	sigs := make([]json.RawMessage, 0, len(c.pending))
	for _, s := range c.pending {
		sigs = append(sigs, s)
	}
	c.pending = map[string]json.RawMessage{}
	c.ptimer = nil
	c.mu.Unlock()
	if len(sigs) == 0 {
		return
	}
	arr, err := json.Marshal(sigs)
	if err != nil {
		return
	}
	b, err := json.Marshal(Message{Kind: "change", Payload: arr})
	if err != nil {
		return
	}
	enqueue(c, b)
}

func (h *Hub) totalClients() int {
	n := 0
	for _, clients := range h.clients {
		n += len(clients)
	}
	return n
}
