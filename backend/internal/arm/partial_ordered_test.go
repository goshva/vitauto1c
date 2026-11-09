package arm

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"vitauto/backend/internal/teststand"
)

// TestPartialOrderedTrigger — миграция 0015: статус «ЧастичноЗаказано» (матрица № 2) выставляется
// триггером arm.line_partial_ordered автоматически, пока потребность продажи покрыта размещёнными
// закупками неполностью. Проверка идёт на seed-стенде, изменения откатываются транзакцией.
func TestPartialOrderedTrigger(t *testing.T) {
	ctx := context.Background()
	pool, err := teststand.Connect(ctx)
	if err != nil {
		t.Skipf("seed-стенд недоступен (%v): разверните seed/supplier-order-stand.ps1 или задайте VITAUTO_SO_DSN", err)
	}
	defer pool.Close()

	var hasTrigger bool
	if err := pool.QueryRow(ctx, `select exists (select 1 from pg_trigger where tgname = 'line_partial_ordered')`).Scan(&hasTrigger); err != nil {
		t.Fatalf("проверка триггера: %v", err)
	}
	if !hasTrigger {
		t.Skip("стенд без миграции 0015: обновите схему (VITAUTO_DB=<DSN стенда> go run ./cmd/migrator schema-up)")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const (
		saleID     = "a0000009-0000-4000-8000-000000000001"
		purchase1  = "a0000009-0000-4000-8000-000000000002"
		purchase2  = "a0000009-0000-4000-8000-000000000003"
		linkKey    = "test:partial-ordered:LK"
		saleOnec   = "test:partial-ordered:sale"
		purchOnec1 = "test:partial-ordered:p1"
		purchOnec2 = "test:partial-ordered:p2"
	)

	insert := func(id, onecKey, operation, status string, qty float64) {
		t.Helper()
		if _, err := tx.Exec(ctx, `insert into arm.line (id, onec_key, customer_order_id, link_key, operation, status, quantity)
			values ($1::uuid, $2, $3::uuid, $4, $5, $6, $7)`,
			id, onecKey, teststand.OrderID, linkKey, operation, status, qty); err != nil {
			t.Fatalf("insert %s: %v", onecKey, err)
		}
	}
	// продажа 5 шт: закупки 3 + 2 шт (требование 5 покрывается двумя закупками)
	insert(saleID, saleOnec, "Продажа", "ВРаботе", 5)
	insert(purchase1, purchOnec1, "Закупка", "Черновик", 3)
	insert(purchase2, purchOnec2, "Закупка", "Черновик", 2)

	if got := txStatus(t, ctx, tx, saleID); got != "ВРаботе" {
		t.Fatalf("после вставки черновых закупок статус %q, хотим «ВРаботе»", got)
	}

	// заказана первая закупка (3 из 5) -> «ЧастичноЗаказано»
	setStatus(t, ctx, tx, purchase1, "Заказано")
	if got := txStatus(t, ctx, tx, saleID); got != "ЧастичноЗаказано" {
		t.Errorf("покрытие 3 из 5: статус %q, хотим «ЧастичноЗаказано»", got)
	}

	// заказана вторая закупка (5 из 5) -> частичный статус снимается
	setStatus(t, ctx, tx, purchase2, "Заказано")
	if got := txStatus(t, ctx, tx, saleID); got != "Заказано" {
		t.Errorf("полное покрытие: статус %q, хотим «Заказано»", got)
	}

	// возврат поставщику по второй закупке (осталось 3 из 5) -> снова «ЧастичноЗаказано»
	setStatus(t, ctx, tx, purchase2, "Возврат")
	if got := txStatus(t, ctx, tx, saleID); got != "ЧастичноЗаказано" {
		t.Errorf("покрытие 3 из 5 после возврата: статус %q, хотим «ЧастичноЗаказано»", got)
	}

	// размещённых закупок не осталось -> причина частичного статуса исчезла
	setStatus(t, ctx, tx, purchase1, "Возврат")
	if got := txStatus(t, ctx, tx, saleID); got != "ВРаботе" {
		t.Errorf("покрытие 0: статус %q, хотим «ВРаботе»", got)
	}

	// строки с партией (покрыты складом) триггер не трогает
	if _, err := tx.Exec(ctx, `update arm.line set batch_id = 'dd000000-0000-0000-0000-000000000001' where id = $1::uuid`, saleID); err != nil {
		t.Fatalf("batch: %v", err)
	}
	if got := txStatus(t, ctx, tx, saleID); got != "ВРаботе" {
		t.Errorf("строка с партией: статус %q, хотим «ВРаботе» (без изменений)", got)
	}
}

func setStatus(t *testing.T, ctx context.Context, tx pgx.Tx, id, status string) {
	t.Helper()
	if _, err := tx.Exec(ctx, `update arm.line set status = $2, marked = false where id = $1::uuid`, id, status); err != nil {
		t.Fatalf("статус %s -> %s: %v", id, status, err)
	}
}

func txStatus(t *testing.T, ctx context.Context, tx pgx.Tx, id string) string {
	t.Helper()
	var status string
	if err := tx.QueryRow(ctx, `select status from arm.line where id = $1::uuid`, id).Scan(&status); err != nil {
		t.Fatalf("статус строки %s: %v", id, err)
	}
	return status
}
