package arm

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"vitauto/backend/internal/teststand"
)

// ФТ п. 2 «Отключение автосоздания в АРМ»: проведение «Заказа клиента» заказ поставщику НЕ создаёт
// (автосоздание отключено; заказ поставщику появляется только явной командой или сценарием «В работе»).
func TestPostOrderDoesNotCreateSupplierOrder(t *testing.T) {
	ctx := context.Background()
	pool, err := teststand.Connect(ctx)
	if err != nil {
		t.Skipf("seed-стенд недоступен (%v): разверните seed/supplier-order-stand.ps1", err)
	}
	defer pool.Close()
	if err := teststand.Reset(ctx, pool); err != nil {
		t.Skipf("seed-стенд не готов: %v", err)
	}
	if err := teststand.PreparePostableSales(ctx, pool, teststand.ManagerUser); err != nil {
		t.Fatal(err)
	}
	svc := &Service{DB: pool, Now: func() time.Time { return time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC) }}
	manager := Actor{UserID: uuid.MustParse(teststand.ManagerUser), UserName: "Менеджер", Role: "manager"}
	res, err := svc.PostOrder(ctx, manager, teststand.OrderID)
	if err != nil {
		t.Fatalf("PostOrder: %v", err)
	}
	if n, _ := res["processed"].(int); n != 1 {
		t.Fatalf("проведено строк %v, хотим 1", res["processed"])
	}
	var posted bool
	if err := pool.QueryRow(ctx, "select coalesce(posted, false) from doc.customer_order where id = $1", teststand.OrderID).Scan(&posted); err != nil {
		t.Fatal(err)
	}
	if !posted {
		t.Error("заказ не проведён")
	}
	var so int
	if err := pool.QueryRow(ctx, "select count(*) from doc.supplier_order where base_doc_id = $1", teststand.OrderID).Scan(&so); err != nil {
		t.Fatal(err)
	}
	if so != 0 {
		t.Errorf("проведение заказа создало %d заказ(ов) поставщику — автосоздание должно быть отключено", so)
	}
}
