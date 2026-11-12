package domain

import (
	"math"
	"testing"

	"github.com/google/uuid"
)

// newLine — строка для тестов Step 2a: продажа, менеджер может править цену и количество
// в статусе «Черновик» (matrix.json: Цена/Количество writable, rights[new] = '+').
func newLine(status Status) *Line {
	return &Line{
		ID:        uuid.Must(uuid.NewV7()),
		Version:   1,
		Operation: OpSale,
		Status:    status,
	}
}

func manager() Actor    { return Actor{UserID: uuid.New(), Role: RoleManager} }
func storekpr() Actor   { return Actor{UserID: uuid.New(), Role: RoleStorekeeper} }
func adminActor() Actor { return Actor{UserID: uuid.New(), Role: RoleAdmin} }

// ——— guards: четыре общих инварианта (02-tactical.md:36-38) ———

func TestGuards_Deleted(t *testing.T) {
	l := newLine(StatusDraft)
	l.Deleted = true
	if err := l.guards(manager(), 0, false); err != ErrDeleted {
		t.Fatalf("guards on deleted line = %v, want ErrDeleted", err)
	}
}

func TestGuards_Version(t *testing.T) {
	l := newLine(StatusDraft)
	l.Version = 7
	if err := l.guards(manager(), 7, false); err != nil {
		t.Fatalf("guards with matching version = %v, want nil", err)
	}
	if err := l.guards(manager(), 6, false); err != ErrVersion {
		t.Fatalf("guards with stale version = %v, want ErrVersion", err)
	}
	// 0 — проверка версии пропускается (пакетные переходы по отмеченным строкам)
	if err := l.guards(manager(), 0, false); err != nil {
		t.Fatalf("guards with expectedVersion=0 = %v, want nil", err)
	}
}

func TestGuards_Locked(t *testing.T) {
	l := newLine(StatusLockedBgJob)
	if err := l.guards(manager(), 0, false); err != ErrLocked {
		t.Fatalf("guards on background-locked line = %v, want ErrLocked", err)
	}
	// allowClosed не снимает фоновую блокировку
	if err := l.guards(manager(), 0, true); err != ErrLocked {
		t.Fatalf("guards locked with allowClosed = %v, want ErrLocked", err)
	}
}

func TestGuards_Closed(t *testing.T) {
	l := newLine(StatusDone)
	l.Version = 1
	if err := l.guards(manager(), 0, false); err != ErrClosed {
		t.Fatalf("guards closed for manager = %v, want ErrClosed", err)
	}
	if err := l.guards(adminActor(), 0, false); err != nil {
		t.Fatalf("guards closed for admin = %v, want nil", err)
	}
	if err := l.guards(manager(), 0, true); err != nil {
		t.Fatalf("guards closed with allowClosed = %v, want nil", err)
	}
}

// TestGuards_ClosedOnlyDone — сторож на NR7: закрытость это ровно StatusDone,
// а НЕ IsClosedSale(). IsClosedSale() — складское понятие «продажи, не держащие склад»
// (status.go:41), участвует только в расчёте остатков (fifo.go). Если расширить guard
// до IsClosedSale(), правка отгруженных строк станет невозможной — регресс, которого нет.
func TestGuards_ClosedOnlyDone(t *testing.T) {
	for _, st := range []Status{StatusShipped, StatusFinished} {
		if !st.IsClosedSale() {
			t.Fatalf("%s должен входить в IsClosedSale()", st.APICode())
		}
		l := newLine(st)
		if err := l.guards(manager(), 0, false); err != nil {
			t.Errorf("guards(%s): закрытость не должна срабатывать для IsClosedSale-статуса, получено %v",
				st.APICode(), err)
		}
	}
	if !StatusDone.IsClosedSale() {
		t.Fatal("StatusDone должен входить в IsClosedSale()")
	}
}

// ——— checkField: матрица прав ———

// TestCheckField_WritableFalse — сторож на ошибку редакции 2: `authorize(a, FieldMarked, …)`
// вернул бы ErrFieldReadonly, потому что «ОтметкаСтроки» в матрице writable=false.
// Именно поэтому команды вызывают guards(), а не authorize(field) (decision Q16).
func TestCheckField_WritableFalse(t *testing.T) {
	l := newLine(StatusDraft)
	if err := l.checkField(manager(), FieldMarked); err != ErrFieldReadonly {
		t.Fatalf("checkField(ОтметкаСтроки, writable=false) = %v, want ErrFieldReadonly", err)
	}
}

func TestCheckField_UnknownField(t *testing.T) {
	l := newLine(StatusDraft)
	if err := l.checkField(manager(), Field("НесуществующееПоле")); err != ErrFieldReadonly {
		t.Fatalf("checkField(unknown) = %v, want ErrFieldReadonly", err)
	}
}

func TestCheckField_Allowed(t *testing.T) {
	l := newLine(StatusDraft)
	if err := l.checkField(manager(), FieldSalePrice); err != nil {
		t.Fatalf("checkField(Цена, manager, new) = %v, want nil", err)
	}
}

func TestCheckField_DeniedByStatus(t *testing.T) {
	// storekeeper: Цена writable, но rights[new] = '.'
	l := newLine(StatusDraft)
	if err := l.checkField(storekpr(), FieldSalePrice); err != ErrMatrixDenied {
		t.Fatalf("checkField(Цена, storekeeper, new) = %v, want ErrMatrixDenied", err)
	}
}

// ——— ChangeField ———

func TestChangeField_Text(t *testing.T) {
	l := newLine(StatusDraft)
	before := l.Version
	if err := l.ChangeField(manager(), FieldFactName, "Фильтр масляный"); err != nil {
		t.Fatalf("ChangeField: %v", err)
	}
	if l.FactName != "Фильтр масляный" {
		t.Errorf("FactName = %q", l.FactName)
	}
	if l.Version != before+1 {
		t.Errorf("Version = %d, want %d", l.Version, before+1)
	}
}

func TestChangeField_UnknownField(t *testing.T) {
	l := newLine(StatusDraft)
	if err := l.ChangeField(manager(), Field("НесуществующееПоле"), "x"); err != ErrFieldReadonly {
		t.Fatalf("ChangeField(unknown) = %v, want ErrFieldReadonly", err)
	}
}

func TestChangeField_WrongType(t *testing.T) {
	l := newLine(StatusDraft)
	if err := l.ChangeField(manager(), FieldQuantity, "не число"); err == nil {
		t.Fatal("ChangeField(Количество, строка) должен вернуть ошибку типа")
	}
}

func TestChangeField_GuardsRunFirst(t *testing.T) {
	l := newLine(StatusDone)
	err := l.ChangeField(manager(), FieldQuantity, 2.0)
	if err != ErrClosed {
		t.Fatalf("ChangeField on closed line = %v, want ErrClosed", err)
	}
	if l.Quantity != 0 {
		t.Errorf("значение изменено несмотря на отказ: Quantity = %v", l.Quantity)
	}
}

// TestChangeField_SignedOriginalOnClosed — ВСЕ 7 ролей в статусе «Выполнено».
//
// Комментарий в ChangeField утверждает, что исключение «ДокументПодписанОригинал» из проверки
// закрытой строки (arm/lines.go:409) не меняет итог, потому что матрица запрещает это поле
// не-администратору во всех статусах. Утверждение проверяется здесь, а не принимается на слово:
// у manager/storekeeper/chief_mechanic/supply rights = "............cc." (в closed — "."),
// у supplier/client — все ".", у admin — все "+" (см. plan.md §2.8).
func TestChangeField_SignedOriginalOnClosed(t *testing.T) {
	cases := []struct {
		role Role
		want error
	}{
		{RoleManager, ErrMatrixDenied},
		{RoleStorekeeper, ErrMatrixDenied},
		{RoleChiefMechanic, ErrMatrixDenied},
		{RoleSupply, ErrMatrixDenied},
		{RoleSupplier, ErrMatrixDenied},
		{RoleClient, ErrMatrixDenied},
		{RoleAdmin, nil}, // admin исключён из closed-guard и имеет '+' во всех статусах
	}
	for _, c := range cases {
		l := newLine(StatusDone)
		err := l.ChangeField(Actor{UserID: uuid.New(), Role: c.role}, FieldSignedOriginal, true)
		if err != c.want {
			t.Errorf("ChangeField(ДокументПодписанОригинал, %s, closed) = %v, want %v", c.role, err, c.want)
		}
		if c.want == nil && !l.SignedOriginal {
			t.Errorf("%s: поле не установлено, хотя команда прошла", c.role)
		}
		if c.want != nil && l.SignedOriginal {
			t.Errorf("%s: поле установлено, хотя команда отклонена", c.role)
		}
	}
}

// TestChangeField_SignedOriginalNotClosed — тот же набор ролей, но в статусе, где матрица
// даёт право 'c' (shipped): тогда отказ идёт от правила «только автор пометки»,
// и это подтверждает, что поле в принципе достижимо по матрице, а не запрещено везде.
func TestChangeField_SignedOriginalNotClosed(t *testing.T) {
	for _, role := range []Role{RoleManager, RoleStorekeeper, RoleChiefMechanic, RoleSupply} {
		l := newLine(StatusShipped)
		l.MarkedBy = nil // отметки нет → правило 'c' не пропускает
		err := l.ChangeField(Actor{UserID: uuid.New(), Role: role}, FieldSignedOriginal, true)
		if err != ErrNotAuthor {
			t.Errorf("ChangeField(ДокументПодписанОригинал, %s, shipped, без отметки) = %v, want ErrNotAuthor", role, err)
		}
	}
}

// TestChangeField_SignedOriginalAsAdmin — у администратора это поле доступно и на закрытой строке.
func TestChangeField_SignedOriginalAsAdmin(t *testing.T) {
	l := newLine(StatusDone)
	if err := l.ChangeField(adminActor(), FieldSignedOriginal, true); err != nil {
		t.Fatalf("ChangeField(ДокументПодписанОригинал, admin, closed) = %v, want nil", err)
	}
	if !l.SignedOriginal {
		t.Error("SignedOriginal не установлен")
	}
}

// TestChangeField_OtherFieldOnClosed — прочие поля на закрытой строке отказывают по guards.
func TestChangeField_OtherFieldOnClosed(t *testing.T) {
	l := newLine(StatusDone)
	if err := l.ChangeField(manager(), FieldSalePrice, 100.0); err != ErrClosed {
		t.Fatalf("ChangeField(Цена, manager, closed) = %v, want ErrClosed", err)
	}
}

// ——— RejectAssembly: guards вызываются первой строкой (ревью §6.4) ———

// TestRejectAssembly_Guards — до правки команда проверяла только роль и статус,
// поэтому удалённую строку можно было отклонить, а заблокированную фоном — изменить.
func TestRejectAssembly_Guards(t *testing.T) {
	storekeeper := Actor{UserID: uuid.New(), Role: RoleStorekeeper}

	deleted := newLine(StatusAssembled)
	deleted.Deleted = true
	if err := deleted.RejectAssembly(storekeeper, "причина"); err != ErrDeleted {
		t.Errorf("RejectAssembly на удалённой строке = %v, want ErrDeleted", err)
	}

	locked := newLine(StatusAssembled)
	locked.Status = StatusLockedBgJob
	if err := locked.RejectAssembly(storekeeper, "причина"); err != ErrLocked {
		t.Errorf("RejectAssembly на заблокированной фоном = %v, want ErrLocked", err)
	}

	stale := newLine(StatusAssembled)
	stale.Version = 5
	a := storekeeper
	a.IfMatch = 4
	if err := stale.RejectAssembly(a, "причина"); err != ErrVersion {
		t.Errorf("RejectAssembly с устаревшей версией = %v, want ErrVersion", err)
	}
}

func TestRejectAssembly_OK(t *testing.T) {
	l := newLine(StatusAssembled)
	a := Actor{UserID: uuid.New(), Role: RoleStorekeeper}
	if err := l.RejectAssembly(a, "нет на складе"); err != nil {
		t.Fatalf("RejectAssembly = %v, want nil", err)
	}
	if l.Status != StatusAssembly {
		t.Errorf("Status = %s, want %s", l.Status.APICode(), StatusAssembly.APICode())
	}
	if l.Comment2 != "нет на складе" {
		t.Errorf("Comment2 = %q", l.Comment2)
	}
	if len(l.Events()) != 1 {
		t.Errorf("событий %d, want 1", len(l.Events()))
	}
}

// ——— Формулы FR-7..9 (перенос arm/lines.go:428-457) ———

// TestRecalcSums_TableDriven — таблица формул: что и при каком изменённом поле пересчитывается.
// Покрывает все ветви recalcSums, включая «ничего не меняется» (правка поля, не входящего
// в формулы) и закупку (формулы продажи не применяются).
func TestRecalcSums_TableDriven(t *testing.T) {
	type cs struct {
		name                  string
		op                    Operation
		qty, cost, coeff, rrc float64
		sale                  float64
		field                 Field
		value                 any
		wantCostSum           float64
		wantSale              float64
		wantCoeff             float64
		wantChangeType        int
	}
	cases := []cs{
		{"количество → cost_sum", OpSale, 3, 100, 0, 0, 0, FieldQuantity, 5.0, 500, 0, 0, 0},
		{"себестоимость → cost_sum", OpSale, 3, 100, 0, 0, 0, FieldCostPrice, 250.0, 750, 0, 0, 0},
		{"коэффициент → цена", OpSale, 0, 1000, 0, 0, 0, FieldCoeff, 30.0, 0, 1300, 30, 2},
		{"цена вручную → коэффициент", OpSale, 0, 1000, 0, 0, 0, FieldSalePrice, 1500.0, 0, 1500, 50, 1},
		{"себестоимость при коэффициенте → цена", OpSale, 0, 1000, 30, 0, 0, FieldCostPrice, 2000.0, 0, 2600, 30, 0},
		{"нулевая себестоимость → no-op", OpSale, 0, 0, 0, 0, 0, FieldCoeff, 30.0, 0, 0, 30, 0},
		{"нулевой коэффициент → no-op", OpSale, 0, 1000, 0, 0, 0, FieldCoeff, 0.0, 0, 0, 0, 0},
		{"постороннее поле → формулы молчат", OpSale, 0, 1000, 30, 0, 0, FieldRRC, 999.0, 0, 0, 30, 0},
		{"закупка → формулы продажи не применяются", OpPurchase, 0, 1000, 0, 0, 0, FieldCoeff, 30.0, 0, 0, 30, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			l := newLine(StatusDraft)
			l.Operation = c.op
			l.Quantity, l.CostPrice, l.Coeff, l.RRC, l.SalePrice = c.qty, c.cost, c.coeff, c.rrc, c.sale
			// админ: у него '+' по всем полям во всех статусах, поэтому проверяются формулы,
			// а не матрица (матрица покрыта отдельными тестами checkField)
			if err := l.ChangeField(adminActor(), c.field, c.value); err != nil {
				t.Fatalf("ChangeField(%s): %v", c.field, err)
			}
			if diff(l.CostSum, c.wantCostSum) {
				t.Errorf("CostSum = %v, want %v", l.CostSum, c.wantCostSum)
			}
			if diff(l.SalePrice, c.wantSale) {
				t.Errorf("SalePrice = %v, want %v", l.SalePrice, c.wantSale)
			}
			if diff(l.Coeff, c.wantCoeff) {
				t.Errorf("Coeff = %v, want %v", l.Coeff, c.wantCoeff)
			}
			if l.PriceChangeType != c.wantChangeType {
				t.Errorf("PriceChangeType = %d, want %d", l.PriceChangeType, c.wantChangeType)
			}
		})
	}
}

func diff(a, b float64) bool { return math.Abs(a-b) > 1e-9 }

func TestRecalcSums_CostSum(t *testing.T) {
	l := newLine(StatusDraft)
	l.Quantity, l.CostPrice = 3, 100
	if err := l.ChangeField(manager(), FieldQuantity, 5.0); err != nil {
		t.Fatal(err)
	}
	if l.CostSum != 500 {
		t.Errorf("cost_sum = %v, want 500 (5 × 100)", l.CostSum)
	}

	l2 := newLine(StatusDraft)
	l2.Quantity, l2.CostPrice = 3, 100
	if err := l2.ChangeField(manager(), FieldCostPrice, 250.0); err != nil {
		t.Fatal(err)
	}
	if l2.CostSum != 750 {
		t.Errorf("cost_sum = %v, want 750 (3 × 250)", l2.CostSum)
	}
}

func TestRecalcSums_SalePriceFromCoeff(t *testing.T) {
	l := newLine(StatusDraft)
	l.CostPrice, l.Coeff = 1000, 0
	if err := l.ChangeField(manager(), FieldCoeff, 30.0); err != nil {
		t.Fatal(err)
	}
	if l.SalePrice != 1300 {
		t.Errorf("sale_price = %v, want 1300 (1000 × 1.30)", l.SalePrice)
	}
	if l.PriceChangeType != 2 {
		t.Errorf("price_change_type = %d, want 2", l.PriceChangeType)
	}
}

func TestRecalcSums_SalePriceOnCostChange(t *testing.T) {
	l := newLine(StatusDraft)
	l.CostPrice, l.Coeff = 1000, 30
	// изменение себестоимости при ненулевом коэффициенте пересчитывает цену,
	// но НЕ трогает price_change_type (arm/lines.go:451-456)
	if err := l.ChangeField(manager(), FieldCostPrice, 2000.0); err != nil {
		t.Fatal(err)
	}
	if l.SalePrice != 2600 {
		t.Errorf("sale_price = %v, want 2600 (2000 × 1.30)", l.SalePrice)
	}
	if l.PriceChangeType != 0 {
		t.Errorf("price_change_type = %d, want 0 (не меняется при правке себестоимости)", l.PriceChangeType)
	}
}

func TestRecalcSums_ManualPriceSetsCoeff(t *testing.T) {
	l := newLine(StatusDraft)
	l.CostPrice, l.Coeff = 1000, 0
	if err := l.ChangeField(manager(), FieldSalePrice, 1500.0); err != nil {
		t.Fatal(err)
	}
	// коэффициент при ручном вводе цены НЕ округляется
	if math.Abs(l.Coeff-50) > 1e-9 {
		t.Errorf("coefficient = %v, want 50", l.Coeff)
	}
	if l.PriceChangeType != 1 {
		t.Errorf("price_change_type = %d, want 1", l.PriceChangeType)
	}
}

// TestRecalcSums_ZeroCostPrice — при нулевой себестоимости формулы продажи не выполняются
// (arm/lines.go:449,451 — обе ветви под `base != 0`).
//
// Проверка `l.CostPrice == 0` покрыта отдельно, а не только через таблицу, потому что её
// удаление НЕ приводит к панике: в Go деление float на ноль даёт ±Inf, то есть коэффициент
// молча становится +Inf и уезжает в базу. Именно это и ловит тест — проверено удалением
// условия: `coefficient = +Inf, want 0` и `price_change_type = 2, want 0`.
func TestRecalcSums_ZeroCostPrice(t *testing.T) {
	// 1. Коэффициент при нулевой себестоимости: no-op, не паника.
	l := newLine(StatusDraft)
	l.CostPrice, l.Coeff = 0, 0
	if err := l.ChangeField(manager(), FieldCoeff, 30.0); err != nil {
		t.Fatalf("ChangeField(Коэффициент) при cost=0: %v", err)
	}
	if l.SalePrice != 0 {
		t.Errorf("sale_price = %v, want 0", l.SalePrice)
	}
	if l.PriceChangeType != 0 {
		t.Errorf("price_change_type = %d, want 0", l.PriceChangeType)
	}

	// 2. Ручная цена при нулевой себестоимости: коэффициент не вычисляется (деление на ноль),
	//    цена сохраняется как введена.
	l2 := newLine(StatusDraft)
	l2.CostPrice, l2.Coeff = 0, 0
	if err := l2.ChangeField(manager(), FieldSalePrice, 1500.0); err != nil {
		t.Fatalf("ChangeField(Цена) при cost=0: %v", err)
	}
	if l2.SalePrice != 1500 {
		t.Errorf("sale_price = %v, want 1500 (введённое значение сохраняется)", l2.SalePrice)
	}
	if l2.Coeff != 0 {
		t.Errorf("coefficient = %v, want 0: при base == 0 коэффициент не пересчитывается", l2.Coeff)
	}
	if l2.PriceChangeType != 0 {
		t.Errorf("price_change_type = %d, want 0", l2.PriceChangeType)
	}
}

// TestRecalcSums_PriceChangeType — новое поле Line, введённое в Step 2a вместе с формулами.
// 1 — цена введена вручную (ветвь «Цена»), 2 — цена пересчитана от коэффициента (ветвь
// «Коэффициент»); при правке себестоимости и при no-op значение не меняется (arm/lines.go:450,454).
func TestRecalcSums_PriceChangeType(t *testing.T) {
	cases := []struct {
		name        string
		op          Operation
		cost, coeff float64
		field       Field
		value       any
		want        int
	}{
		{"ручная цена", OpSale, 1000, 0, FieldSalePrice, 1500.0, 1},
		{"коэффициент", OpSale, 1000, 0, FieldCoeff, 30.0, 2},
		{"себестоимость при коэффициенте", OpSale, 1000, 30, FieldCostPrice, 2000.0, 0},
		{"нулевой коэффициент", OpSale, 1000, 0, FieldCoeff, 0.0, 0},
		{"нулевая себестоимость", OpSale, 0, 0, FieldCoeff, 30.0, 0},
		{"закупка", OpPurchase, 1000, 0, FieldCoeff, 30.0, 0},
		{"постороннее поле", OpSale, 1000, 30, FieldRRC, 999.0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			l := newLine(StatusDraft)
			l.Operation, l.CostPrice, l.Coeff = c.op, c.cost, c.coeff
			if err := l.ChangeField(adminActor(), c.field, c.value); err != nil {
				t.Fatalf("ChangeField(%s): %v", c.field, err)
			}
			if l.PriceChangeType != c.want {
				t.Errorf("price_change_type = %d, want %d", l.PriceChangeType, c.want)
			}
		})
	}
}

func TestRecalcSums_PurchaseHasNoSaleFormula(t *testing.T) {
	l := newLine(StatusDraft)
	l.Operation = OpPurchase
	l.CostPrice, l.Coeff = 1000, 0
	if err := l.ChangeField(adminActor(), FieldCoeff, 30.0); err != nil {
		t.Fatal(err)
	}
	if l.SalePrice != 0 {
		t.Errorf("sale_price = %v, want 0: формулы продажи к закупке не применяются", l.SalePrice)
	}
}

// TestRecalcSums_NormHoursIrrelevant — сторож на ошибку редакции 3 плана: там был тест
// «TestRecalcSums_NormHoursWins», будто norm_hours влияет на хранимую sale_price.
// В arm/lines.go нормо-часов в формулах НЕТ: они участвуют только в вычисляемой сумме
// продажи (Line.SaleSum и представление arm.line_api:115).
func TestRecalcSums_NormHoursIrrelevant(t *testing.T) {
	l := newLine(StatusDraft)
	l.CostPrice, l.Coeff, l.NormHours = 1000, 0, 5
	if err := l.ChangeField(manager(), FieldCoeff, 30.0); err != nil {
		t.Fatal(err)
	}
	if l.SalePrice != 1300 {
		t.Errorf("sale_price = %v, want 1300: norm_hours не влияет на хранимую цену", l.SalePrice)
	}
}

// TestRound2_Golden — золотые значения округления. Точно такая же таблица проверяется
// в arm (TestRound2_GoldenArm): формулы на write- и read-стороне обязаны совпадать
// до копейки. Если изменить один round2, его собственный тест упадёт.
func TestRound2_Golden(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{0, 0}, {1, 1}, {1.004, 1.0}, {1.005, 1.01}, {1.006, 1.01},
		{2.675, 2.68}, {1000 * 1.3, 1300}, {-1.005, -1.01}, {-2.675, -2.68},
		{0.1 + 0.2, 0.3}, {999.999, 1000}, {1234.5678, 1234.57},
	}
	for _, c := range cases {
		if got := round2(c.in); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("round2(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

// ——— Поля: карта сгенерирована и связна ———

func TestFields_Generated(t *testing.T) {
	if len(Fields) != 67 {
		t.Errorf("Fields: %d записей, ожидалось 67 (arm/fields_gen.go)", len(Fields))
	}
	for name, info := range Fields {
		if name == "" || info.Column == "" || info.Kind == "" {
			t.Errorf("Fields[%q] = %+v: пустые поля недопустимы", name, info)
		}
	}
}

// TestFields_SetterCoverage — граница агрегата видна и измерима: setters покрывают
// только поля, которые моделирует Line. Остальные поля регистра домен не применяет,
// и это осознанная граница (line.go:34), а не пробел в реализации.
func TestFields_SetterCoverage(t *testing.T) {
	if len(setters) == 0 {
		t.Fatal("таблица setters пуста")
	}
	for f := range setters {
		info, ok := Fields[f]
		if !ok {
			t.Errorf("setter для %q отсутствует в Fields: поле не из регистра 1С", f)
			continue
		}
		_ = info
	}
	// Ключевые поля формул обязаны быть в таблице
	for _, f := range []Field{FieldQuantity, FieldCostPrice, FieldSalePrice, FieldCoeff, FieldSignedOriginal} {
		if _, ok := settersFor(f); !ok {
			t.Errorf("нет setter для %q — формула не сможет применить значение", f)
		}
	}
	// Известная граница: 67 полей регистра против ~32 смоделированных агрегатом
	if len(setters) >= len(Fields) {
		t.Logf("setters=%d, Fields=%d", len(setters), len(Fields))
	}
}
