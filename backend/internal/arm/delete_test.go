package arm

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"vitauto/backend/internal/teststand"
)

// safeCall превращает панику (обращение к nil-БД до гейта роли) в ошибку:
// красный тест до фикса не должен ронять весь пакет.
func safeCall(f func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	return f()
}

// ФТ п. 8: право «Удаление» — только у администратора. Гейт роли стоит до обращения к БД,
// поэтому Service без пула достаточно.
func TestDeleteOnlyAdmin(t *testing.T) {
	svc := &Service{}
	ctx := context.Background()
	id := uuid.Must(uuid.NewV7()).String()
	for _, role := range []string{"manager", "storekeeper", "chief_mechanic", "supply", "supplier", "client", ""} {
		a := Actor{UserID: uuid.Must(uuid.NewV7()), UserName: "X", Role: role}
		t.Run("strike/"+role, func(t *testing.T) {
			requireProblem(t, safeCall(func() error { return svc.StrikeLine(ctx, a, id) }), 403, "matrix_denied")
		})
		t.Run("order/"+role, func(t *testing.T) {
			requireProblem(t, safeCall(func() error { return svc.DeleteOrder(ctx, a, id) }), 403, "matrix_denied")
		})
	}
}

// Интеграционный: администратор вычеркивает строку стенда (нужен VITAUTO_SO_DSN).
func TestStrikeLineByAdmin(t *testing.T) {
	ctx := context.Background()
	pool, err := teststand.Connect(ctx)
	if err != nil {
		t.Skipf("seed-стенд недоступен (%v): разверните seed/supplier-order-stand.ps1", err)
	}
	defer pool.Close()
	if err := teststand.Reset(ctx, pool); err != nil {
		t.Skipf("seed-стенд не готов: %v", err)
	}
	svc := &Service{DB: pool}
	admin := Actor{UserID: uuid.MustParse(teststand.AdminUser), UserName: "Администратор", Role: "admin"}
	// S1 стенда — продажа «ВРаботе» без отметки, связанная с закупкой L1 (link_key SO-STAND-LK-1):
	// вычеркивание идёт по ключу связи, продажа обязана быть (strikeKeys пропускает ключ без продажи).
	if err := svc.StrikeLine(ctx, admin, teststand.SaleLinked); err != nil {
		t.Fatalf("админ не смог вычеркнуть строку: %v", err)
	}
	var deleted bool
	if err := pool.QueryRow(ctx, "select deleted from arm.line where id = $1", teststand.SaleLinked).Scan(&deleted); err != nil {
		t.Fatal(err)
	}
	if !deleted {
		t.Error("строка не помечена удалённой")
	}
	if err := pool.QueryRow(ctx, "select deleted from arm.line where id = $1", teststand.PurchaseA).Scan(&deleted); err != nil {
		t.Fatal(err)
	}
	if !deleted {
		t.Error("связанная закупка не вычеркнута вместе с продажей")
	}
}
