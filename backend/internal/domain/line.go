package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Ошибки домена (application layer конвертирует в Problem).
var (
	ErrNotFound       = errors.New("строка не найдена")
	ErrVersion        = errors.New("строка изменена другим пользователем (version)")
	ErrDeleted        = errors.New("строка удалена")
	ErrLocked         = errors.New("строка заблокирована фоном")
	ErrClosed         = errors.New("закрытую строку меняет только администратор")
	ErrNothingMarked  = errors.New("нет отмеченных строк")
	ErrMatrixDenied   = errors.New("матрица: действие недоступно")
	ErrNotAuthor      = errors.New("меняет только автор строки")
	ErrFieldReadonly  = errors.New("поле только для чтения")
	ErrFSM            = errors.New("переход недоступен из текущего статуса")
	ErrStatusViaFSM   = errors.New("статус меняется переходами процесса")
)

// Actor — пользователь, выполняющий команду (порт из application).
type Actor struct {
	UserID   uuid.UUID
	UserName string
	Login    string
	Role     string
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

// Authorize — 5 проверок команды над строкой (02-tactical.md §Line.authorize):
// версия, пометка, закрытая строка, матрица поля, блокировка фона.
// expectedVersion == 0 — проверка версии пропускается (переходы по отмеченным строкам).
func (l *Line) Authorize(a Actor, field string, expectedVersion int64) error {
	if l.Deleted {
		return ErrDeleted
	}
	if expectedVersion != 0 && l.Version != expectedVersion {
		return ErrVersion
	}
	if l.Status == StatusLockedBgJob {
		return ErrLocked
	}
	if l.Status == StatusDone && a.Role != "admin" {
		return ErrClosed
	}
	if field != "" {
		col, ok := ColumnFor(a.Role, field)
		if !ok {
			return ErrFieldReadonly
		}
		why := DenyReason(a.Role, col, l.Status, l.MarkedByMe(a))
		switch {
		case why == "":
		case why == "меняет только автор строки":
			return ErrNotAuthor
		case why == "поле только для чтения", why == "строка заблокирована фоном":
			return ErrFieldReadonly
		default:
			return ErrMatrixDenied
		}
	}
	return nil
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
func (l *Line) RejectAssembly(a Actor, reason string) error {
	if !contains([]string{"storekeeper", "admin"}, a.Role) {
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
