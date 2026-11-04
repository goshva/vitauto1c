// Package integration — фоновые процессы связки Go ⇄ 1С (раздел 14 плана, ТР-И1/ТЧИ1).
//
// OutboxWorker вычитывает integration.outbox и передаёт документы в 1С через
// OData-регистра команд расширении АРМ_OData (InformationRegister_АрмOData_КомандыPWA):
// 1С сама выполняет запись регистра (ВыполнитьДляЗаписи) и возвращает Результат.
// Идемпотентность: ссылаемся на entity_id (Ref_Key = UUID), повторная отправка безопасна.
//
// Конфигурация (cmd/api): VITAUTO_1C_URL (publication/odata/standard.odata),
// VITAUTO_1C_USER, VITAUTO_1C_PASS; без URL воркер не запускается — записи копятся в очереди.
package integration

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Outbox — настройки и состояние воркера.
type Outbox struct {
	DB       *pgxpool.Pool
	BaseURL  string // .../odata/standard.odata
	User     string
	Password string
	Interval time.Duration // пауза между опросами (по умолчанию 5 с)
	MaxTries int           // попыток до status='dead' (по умолчанию 5)
	Client   *http.Client
}

type outboxRow struct {
	ID       uuid.UUID
	Entity   string
	EntityID uuid.UUID
	Payload  []byte
	Attempts int
}

// Командный канал расширении АРМ_OData и команда выгрузки из нового стека
// (odata/АрмOData_Команды.bsl, АрмOData_КомандыPWA.RecordSet.bsl).
const (
	commandRegister = "InformationRegister_АрмOData_КомандыPWA"
	outboxCommand   = "ИзАРМ"
)

// Run — цикл воркера до отмены ctx. Один раунд за раз; ошибки не останавливают цикл.
func (o *Outbox) Run(ctx context.Context) {
	interval := o.Interval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	maxTries := o.MaxTries
	if maxTries <= 0 {
		maxTries = 5
	}
	client := o.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	log.Printf("[outbox] worker запущен: %s, интервал %s", o.BaseURL, interval)
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Print("[outbox] worker остановлен")
			return
		case <-t.C:
			n, err := o.processBatch(ctx, maxTries, client)
			if err != nil {
				log.Printf("[outbox] раунд: %v", err)
			} else if n > 0 {
				log.Printf("[outbox] отправлено документов: %d", n)
			}
		}
	}
}

// processBatch — одна пачка: grab N записей, отправка, статусы. Возвращает число sent.
func (o *Outbox) processBatch(ctx context.Context, maxTries int, client *http.Client) (int, error) {
	tx, err := o.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	// SKIP LOCKED — безопасный параллельный запуск нескольких воркеров.
	rows, err := tx.Query(ctx, `select id, entity, entity_id, payload, attempts
		from integration.outbox
		where status in ('new', 'failed') and attempts < $1
		order by created_at
		limit 20
		for update skip locked`, maxTries)
	if err != nil {
		return 0, err
	}
	var batch []outboxRow
	for rows.Next() {
		var r outboxRow
		if err := rows.Scan(&r.ID, &r.Entity, &r.EntityID, &r.Payload, &r.Attempts); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, r)
	}
	rows.Close()
	if len(batch) == 0 {
		return 0, tx.Commit(ctx)
	}

	sent := 0
	for _, r := range batch {
		if err := o.send(ctx, client, r); err != nil {
			// retry с экспоненциальной задержкой задаётся интервалом тикера; здесь только фиксация
			status := "failed"
			if r.Attempts+1 >= maxTries {
				status = "dead"
			}
			if _, uerr := o.DB.Exec(ctx, `update integration.outbox
				set status = $2, attempts = attempts + 1, error = $3 where id = $1`,
				r.ID, status, trunc(err.Error(), 500)); uerr != nil {
				return sent, uerr
			}
			log.Printf("[outbox] %s/%s попытка %d: %v", r.Entity, r.EntityID, r.Attempts+1, err)
			continue
		}
		if _, err := o.DB.Exec(ctx, `update integration.outbox
			set status = 'sent', sent_at = now(), error = null where id = $1`, r.ID); err != nil {
			return sent, err
		}
		sent++
	}
	return sent, tx.Commit(ctx)
}

// send — POST записи регистра команд: 1С выполняет команду при записи и возвращает Результат JSON.
// Тело — как в pwa/src/odata/backend.js (командный канал АРМ_OData v1.1).
func (o *Outbox) send(ctx context.Context, client *http.Client, r outboxRow) error {
	params, _ := json.Marshal(map[string]any{
		"entity":   r.Entity,
		"entityId": r.EntityID.String(),
		"payload":  json.RawMessage(r.Payload),
	})
	// Поля регистра — как в pwa/src/odata/backend.js: поле «Пользователь» заполняет сама 1С.
	rec := map[string]string{
		"Ид":        "outbox-" + r.ID.String(),
		"Команда":   outboxCommand,
		"Параметры": string(params),
	}
	body, err := json.Marshal(rec) // standard.odata: плоская запись без обёртки
	if err != nil {
		return err
	}
	url := o.BaseURL + "/" + url.PathEscape(commandRegister) + "?$format=json"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if o.User != "" {
		req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(o.User+":"+o.Password)))
	}
	res, err := client.Do(req)
	if err != nil {
		return err // сеть/1С недоступна — временная ошибка, повторим в следующем раунде
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 400 {
		return fmt.Errorf("1С HTTP %d: %s", res.StatusCode, trunc(string(data), 300))
	}
	// Результат команды: {"Успешно":true|false,"Результат":"{...}"}
	var out struct {
		Успешно   *bool  `json:"Успешно"`
		Результат string `json:"Результат"`
	}
	if err := json.Unmarshal(data, &out); err == nil && out.Успешно != nil && !*out.Успешно {
		return fmt.Errorf("1С команда %s: %s", outboxCommand, trunc(out.Результат, 300))
	}
	return nil
}

func trunc(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
