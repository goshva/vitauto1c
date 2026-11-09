// Package teststand — доступ к seed-стенду «Заказ поставщику по кнопке» (seed/supplier-order-stand.sql).
// Используется тестами backend/internal/arm и backend/internal/api: тесты не создают данные сами,
// а поднимают стенд тем же SQL, что и seed/supplier-order-stand.ps1, поэтому проверяется и он.
package teststand

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DSN — база стенда. По умолчанию vitauto_so_stand на локальном PostgreSQL; переопределяется VITAUTO_SO_DSN.
func DSN() string {
	if v := os.Getenv("VITAUTO_SO_DSN"); v != "" {
		return v
	}
	return "postgres://postgres:postgres@127.0.0.1:5432/vitauto_so_stand"
}

// Фиксированные ИД строк стенда (совпадают с seed/supplier-order-stand.sql).
const (
	OrderID = "a0000003-0000-4000-8000-000000000001"

	PurchaseA          = "a0000001-0000-4000-8000-000000000001" // АвтооптТорг, LK-1
	PurchaseB          = "a0000001-0000-4000-8000-000000000002" // АвтооптТорг, LK-2
	PurchaseC          = "a0000001-0000-4000-8000-000000000003" // ДеталиОпт, LK-3
	PurchaseNoSupplier = "a0000001-0000-4000-8000-000000000004" // без поставщика
	PurchaseUnmarked   = "a0000001-0000-4000-8000-000000000005" // без отметки
	PurchaseForeign    = "a0000001-0000-4000-8000-000000000006" // отметка Менеджера

	SaleLinked    = "a0000002-0000-4000-8000-000000000001" // LK-1, количество совпадает
	SaleQtyDiff   = "a0000002-0000-4000-8000-000000000002" // LK-2, количество другое
	SaleLinkedC   = "a0000002-0000-4000-8000-000000000003" // LK-3, количество совпадает

	SupplyUser      = "00000000-0000-0000-0000-000000000003"
	AdminUser       = "00000000-0000-0000-0000-000000000001"
	ManagerUser     = "00000000-0000-0000-0000-000000000002"
	StorekeeperUser = "00000000-0000-0000-0000-000000000004"

	SupplyLogin         = "Снабженец"
	SupplyPassword      = "supply123"
	ManagerLogin        = "Менеджер"
	ManagerPassword     = "manager123"
	StorekeeperLogin    = "Кладовщик"
	StorekeeperPassword = "storekeeper123"

	NomenclatureFilter = "77777777-7777-7777-7777-777777777702"
	Customer           = "66666666-6666-6666-6666-666666666601"
	CustomerContract   = "ee000000-0000-0000-0000-000000000003"
	MainWarehouse      = "44444444-4444-4444-4444-444444444401"

	SupplierA = "66666666-6666-6666-6666-666666666604"
	SupplierB = "66666666-6666-6666-6666-666666666605"
)

// Connect — пул к стенду. Ошибка означает, что стенд не развёрнут: тест пропускается.
func Connect(ctx context.Context) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, DSN())
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("%s: %w", DSN(), err)
	}
	return pool, nil
}

// Reset возвращает стенд в исходное состояние: перезаливает seed/supplier-order-stand.sql (он идемпотентен)
// и удаляет заказы поставщику, созданные предыдущими прогонами поверх заказа покупателя стенда.
func Reset(ctx context.Context, pool *pgxpool.Pool) error {
	sql, err := os.ReadFile(filepath.Join(RepoRoot(), "seed", "supplier-order-stand.sql"))
	if err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, string(sql), pgx.QueryExecModeSimpleProtocol); err != nil {
		return fmt.Errorf("заливка seed/supplier-order-stand.sql: %w", err)
	}
	// одной командой нельзя: pgx с параметром уходит в extended protocol, а там несколько команд запрещены
	if _, err := pool.Exec(ctx, `update arm.line set supplier_order_id = null, supplier_order_date = null
		where onec_key like 'stand:so:%'`); err != nil {
		return fmt.Errorf("сброс привязок строк стенда: %w", err)
	}
	for _, del := range []string{
		`delete from integration.outbox where entity = 'supplier_order'
			and entity_id in (select id from doc.supplier_order where base_doc_id = $1)`,
		`delete from doc.supplier_order_item where doc_id in (select id from doc.supplier_order where base_doc_id = $1)`,
		`delete from doc.supplier_order where base_doc_id = $1`,
	} {
		if _, err := pool.Exec(ctx, del, OrderID); err != nil {
			return fmt.Errorf("очистка документов стенда: %w", err)
		}
	}
	return nil
}

// PreparePostableSales готовит стенд к проведению «Заказа клиента»: продажа S1 — «Подготовлено»,
// отмечена пользователем userID, с номенклатурой, количеством, ценой, покупателем и договором —
// ровно то, что требует Service.PostOrder. Используется тестами «проведение не создаёт заказ поставщику» (ФТ п. 2).
func PreparePostableSales(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	_, err := pool.Exec(ctx, `update arm.line set status = 'Подготовлено', marked = true, marked_by_id = $2,
		nomenclature_id = $3, quantity = 3, sale_price = 1200, customer_id = $4, contract_id = $5,
		supplier_order_id = null, supplier_order_date = null, deleted = false
		where id = $1`, SaleLinked, userID, NomenclatureFilter, Customer, CustomerContract)
	return err
}

// PrepareFilterFixture расставляет атрибуты строк стенда для проверки отборов GET /lines (ФТ п. 7):
// разные даты заказа, артикул/№ заказа клиента, склад, удалённая строка, отгруженная строка.
func PrepareFilterFixture(ctx context.Context, pool *pgxpool.Pool) error {
	const q = `update arm.line set
		order_date = case id
			when $1 then '2026-11-01'::timestamp when $2 then '2026-11-05'::timestamp when $3 then '2026-12-01'::timestamp
			when $4 then '2026-11-02'::timestamp when $5 then '2026-11-20'::timestamp when $6 then '2026-11-03'::timestamp
			else order_date end,
		fact_article = case id when $1 then 'ART-1' when $2 then 'ART-2' when $4 then 'ART-S1' else fact_article end,
		client_order_number = case id when $1 then 'ЗК-К-1' when $4 then 'ЗК-К-1' else client_order_number end,
		warehouse_id = case id when $1 then $7::uuid else warehouse_id end,
		deleted = (id = $8)
		where id = any(array[$1,$2,$3,$4,$5,$6,$8]::uuid[])`
	_, err := pool.Exec(ctx, q, PurchaseA, PurchaseB, PurchaseC, SaleLinked, SaleQtyDiff, SaleLinkedC, MainWarehouse, PurchaseForeign)
	if err != nil {
		return err
	}
	// отгруженная продажа S3 и «черновик» закупки L1 — для hideShipped и status
	if _, err := pool.Exec(ctx, `update arm.line set status = 'Отгружено' where id = $1`, SaleLinkedC); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `update arm.line set status = 'Черновик' where id = $1`, PurchaseA)
	return err
}

// RepoRoot — корень репозитория по расположению этого файла (тесты запускаются из своих пакетов).
func RepoRoot() string {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return "."
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}
