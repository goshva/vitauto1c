package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Ошибки домена (application layer конвертирует в Problem).
var (
	ErrNotFound      = errors.New("строка не найдена")
	ErrVersion       = errors.New("строка изменена другим пользователем (version)")
	ErrDeleted       = errors.New("строка удалена")
	ErrLocked        = errors.New("строка заблокирована фоном")
	ErrClosed        = errors.New("закрытую строку меняет только администратор")
	ErrNothingMarked = errors.New("нет отмеченных строк")
	ErrMatrixDenied  = errors.New("матрица: действие недоступно")
	ErrNotAuthor     = errors.New("меняет только автор строки")
	ErrFieldReadonly = errors.New("поле только для чтения")
	ErrFSM           = errors.New("переход недоступен из текущего статуса")
	ErrStatusViaFSM  = errors.New("статус меняется переходами процесса")
)

// Actor — пользователь, выполняющий команду (порт из application).
type Actor struct {
	UserID   uuid.UUID
	UserName string
	Login    string
	Role     Role
	// IfMatch — ожидаемая версия строки (заголовок If-Match). 0 — проверка не требуется.
	// Поле введено в Step 2a: его используют guards и Save. Чтение HTTP-заголовка — Step 4.
	IfMatch int64
}

// Line — агрегат «Строка АРМ» (arm.line, docs/migration/ddd/02-tactical.md).
// Содержит только поля, нужные бизнес-правилам; полный REST-формат даёт view arm.line_api.
type Line struct {
	ID          uuid.UUID
	Version     int64
	LinkKey     string
	Operation   Operation
	Status      Status
	Deleted     bool
	Marked      bool
	MarkedBy    *uuid.UUID
	ManualEdit  bool
	ManualBatch bool
	ManualSplit bool
	SelfPickup  bool

	Order         *uuid.UUID // customer_order_id
	SupplierOrder *uuid.UUID
	Receipt       *uuid.UUID
	Nomenclature  *uuid.UUID
	Batch         *uuid.UUID
	Supplier      *uuid.UUID
	Customer      *uuid.UUID
	Contract      *uuid.UUID
	Cell          *uuid.UUID
	Warehouse     *uuid.UUID

	Quantity  float64
	CostPrice float64
	SalePrice float64
	RRC       float64
	Coeff     float64
	NormHours float64
	CostSum   float64
	// PriceChangeType — как выставлена цена: 1 — вручную (Цена), 2 — коэффициентом.
	// Столбец price_change_type; правила FR-8/FR-9 в arm/lines.go:448-456.
	PriceChangeType int

	SignedOriginal bool
	ShipmentDate   *time.Time
	AssemblySent   *time.Time

	FactName          string
	FactArticle       string
	Comment           string
	Comment2          string
	ClientOrderNumber string

	events []Event
}

// Events — накопленные доменные события (dispatch после коммита транзакции).
func (l *Line) Events() []Event { return l.events }

func (l *Line) raise(e Event) { l.events = append(l.events, e) }

// MarkedByMe — строку пометил этот пользователь (право 'c' в матрице).
func (l *Line) MarkedByMe(a Actor) bool { return l.MarkedBy != nil && *l.MarkedBy == a.UserID }

// SaleSum — сумма продажи: нормо-часы × цена, иначе количество × цена.
func (l *Line) SaleSum() float64 {
	base := l.Quantity
	if l.NormHours > 0 {
		base = l.NormHours
	}
	return base * l.SalePrice
}

// guards — инварианты команды, не зависящие от поля (шаги 1–3 authorize,
// docs/migration/ddd/02-tactical.md:36-38): удалённость, версия, блокировка фона,
// закрытая строка.
//
// expectedVersion == 0 — проверка версии пропускается (пакетные переходы по отмеченным строкам).
// allowClosed — для переходов и для единственного поля, доступного на закрытой строке
// («ДокументПодписанОригинал»): см. Q20 и arm/lines.go:409.
//
// Закрытость — именно StatusDone, а НЕ IsClosedSale(): IsClosedSale() описывает
// «продажи, не держащие склад» (status.go:41) и участвует только в расчёте остатков (fifo.go).
func (l *Line) guards(a Actor, expectedVersion int64, allowClosed bool) error {
	if l.Deleted {
		return ErrDeleted
	}
	if expectedVersion != 0 && l.Version != expectedVersion {
		return ErrVersion
	}
	if l.Status == StatusLockedBgJob {
		return ErrLocked
	}
	if l.Status == StatusDone && a.Role != RoleAdmin && !allowClosed {
		return ErrClosed
	}
	return nil
}

// checkField — инвариант матрицы прав для конкретного поля (шаг 4 authorize,
// 02-tactical.md:39). Матрица — доменная политика, поэтому проверка живёт здесь,
// а не в прикладном слое (decision Q16).
func (l *Line) checkField(a Actor, f Field) error {
	col, ok := ColumnFor(a.Role, f)
	if !ok {
		return ErrFieldReadonly
	}
	switch why := DenyReason(a.Role, col, l.Status, l.MarkedByMe(a)); why {
	case "":
		return nil
	case "меняет только автор строки":
		return ErrNotAuthor
	case "поле только для чтения", "строка заблокирована фоном":
		return ErrFieldReadonly
	default:
		return ErrMatrixDenied
	}
}

// ChangeField — команда изменения одного поля (02-tactical.md §2.1).
// Права и инварианты проверяются внутри команды (decision A1), прикладной слой
// только загружает и сохраняет агрегат.
func (l *Line) ChangeField(a Actor, field Field, value any) error {
	// «ДокументПодписанОригинал» исключён из проверки закрытой строки — как в arm/lines.go:409.
	// Это сохранение ПОРЯДКА проверок arm, а не функциональное исправление: матрица всё равно
	// запрещает это поле не-администратору во всех статусах (у manager rights = "............cc.",
	// в статусе closed — "."), поэтому итоговый ответ и так 403 matrix_denied. С исключением
	// сообщение приходит от матрицы, без него — от проверки закрытой строки.
	allowClosed := field == FieldSignedOriginal
	if err := l.guards(a, a.IfMatch, allowClosed); err != nil {
		return err
	}
	if err := l.checkField(a, field); err != nil {
		return err
	}
	set, ok := settersFor(field)
	if !ok {
		return ErrFieldReadonly
	}
	if err := set(l, value); err != nil {
		return err
	}
	l.recalcSums(field)
	l.Version++
	return nil
}

// recalcSums — формулы матрицы FR-7..9. Точный перенос arm/lines.go:428-457:
//
//	cost_sum    = количество × себестоимость единицы (при изменении любого из них);
//	sale_price  = себестоимость × (1 + коэффициент/100) при изменении коэффициента
//	              или себестоимости, если оба не нулевые;
//	коэффициент = (цена/себестоимость − 1) × 100 при ручном вводе цены, price_change_type = 1;
//	              price_change_type = 2 при пересчёте от коэффициента.
//
// Коэффициент при ручном вводе цены НЕ округляется, цена продажи — округляется round2.
// Нормо-часы в этих формулах не участвуют: они влияют только на вычисляемую сумму
// продажи (Line.SaleSum и представление arm.line_api), а не на хранимую цену.
func (l *Line) recalcSums(f Field) {
	if f == FieldQuantity || f == FieldCostPrice {
		l.CostSum = round2(l.Quantity * l.CostPrice)
	}
	if l.Operation != OpSale || l.CostPrice == 0 {
		return
	}
	switch f {
	case FieldSalePrice:
		l.Coeff = (l.SalePrice/l.CostPrice - 1) * 100
		l.PriceChangeType = 1
	case FieldCoeff:
		if l.Coeff != 0 {
			l.SalePrice = round2(l.CostPrice * (1 + l.Coeff/100))
			l.PriceChangeType = 2
		}
	case FieldCostPrice:
		if l.Coeff != 0 {
			l.SalePrice = round2(l.CostPrice * (1 + l.Coeff/100))
		}
	}
}

// TransitionTo — FSM-переход: проверяет роль и статус, меняет статус, возвращает доменные события.
// now — время для assembly_sent_date (инъекция для тестов).
func (l *Line) TransitionTo(a Actor, to string, now time.Time) error {
	target, err := AllowTransition(to, l.Status, a.Role)
	if err != nil {
		return err
	}
	from := l.Status
	l.Status = target
	if target == StatusAssembly && l.AssemblySent == nil {
		d := dayStart(now)
		l.AssemblySent = &d
	}
	l.Version++
	l.raise(LineStatusChanged{LineID: l.ID, OrderID: l.Order, From: from, To: target, Operation: l.Operation, Actor: a.UserID})
	return nil
}

// Mark — пометка/снятие пометки строки (единственный пользователь-владелец пометки).
func (l *Line) Mark(a Actor, on bool) {
	l.Marked = on
	if on {
		mb := a.UserID
		l.MarkedBy = &mb
	} else {
		l.MarkedBy = nil
	}
	l.Version++
}

// Strike — пометка на удаление (удаление строки АРМ).
func (l *Line) Strike() {
	l.Deleted = true
	l.Marked = false
	l.MarkedBy = nil
	l.Version++
}

// SetSelfPickup — N4: флаг самовывоза.
func (l *Line) SetSelfPickup(on bool) {
	l.SelfPickup = on
	l.Version++
}

// RejectAssembly — M10: кладовщик отклоняет комплектацию (Собран/Подготовлено → Комплектуется, причина в Comment2).
//
// guards() вызывается первой строкой, как и в остальных командах: без него удалённую строку
// можно отклонить, а строку, заблокированную фоном, — изменить (Step 2a, ревью §6.4).
func (l *Line) RejectAssembly(a Actor, reason string) error {
	if err := l.guards(a, a.IfMatch, false); err != nil {
		return err
	}
	if a.Role != RoleStorekeeper && a.Role != RoleAdmin {
		return ErrMatrixDenied
	}
	if l.Status != StatusAssembled && l.Status != StatusPrepared {
		return &StateError{Msg: "отклонение доступно для статусов Собран/Подготовлено", Status: l.Status}
	}
	from := l.Status
	l.Status = StatusAssembly
	l.Comment2 = reason
	l.Version++
	l.raise(AssemblyRejected{LineID: l.ID, OrderID: l.Order, Reason: reason, Actor: a.UserID})
	_ = from
	return nil
}

// StateError — нарушение инварианта статуса (application конвертирует в 409).
type StateError struct {
	Msg    string
	Status Status
}

func (e *StateError) Error() string { return e.Msg }

func dayStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
}
