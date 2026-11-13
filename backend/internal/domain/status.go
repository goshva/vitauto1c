package domain

import "strings"

// Status — статус строки АРМ (перечисление Арм_СтатусыАРМ).
type Status string

const (
	StatusDraft  Status = "Черновик"
	StatusInWork Status = "ВРаботе"
	// StatusPartiallyOrdered ставится автоматически триггером arm.line_partial_ordered,
	// пока потребность продажи покрыта размещёнными закупками неполностью.
	StatusPartiallyOrdered Status = "ЧастичноЗаказано"
	StatusOrdered          Status = "Заказано"
	StatusPaid             Status = "Оплачено"
	StatusInTransit        Status = "ТоварВПути"
	// StatusAwaitingReceipt — вне объёма: приложение его не выставляет (значение только из данных 1С).
	StatusAwaitingReceipt Status = "ОжидаемПоступление"
	StatusAcceptance      Status = "Приходуется"
	StatusToStock         Status = "НаСкладе"
	StatusReserve         Status = "Резервирование"
	StatusAssembly        Status = "Комплектуется"
	StatusPrepared        Status = "Подготовлено"
	StatusAssembled       Status = "Собран"
	StatusShipped         Status = "Отгружено"
	StatusReturn          Status = "Возврат"
	StatusDone            Status = "Выполнено"
	StatusFinished        Status = "Завершено"
	StatusLockedBgJob     Status = "ЗаблокированоФоном"
)

// Operation — операция строки.
type Operation string

const (
	OpSale     Operation = "Продажа"
	OpPurchase Operation = "Закупка"
)

// IsClosedSale — продажи, не держащие склад (ЗакрытыеСтатусыПродаж).
func (s Status) IsClosedSale() bool {
	return s == StatusShipped || s == StatusDone || s == StatusFinished
}

// APICode — код статуса REST API по значению 1С (matrix.json statusEnum, Подготовлено и Собран -> ready_to_ship).
func (s Status) APICode() string {
	switch s {
	case StatusLockedBgJob:
		return "locked_background"
	case StatusDraft:
		return "new"
	case StatusInWork:
		return "in_work"
	case StatusPartiallyOrdered:
		return "partially_ordered"
	case StatusOrdered:
		return "ordered"
	case StatusPaid:
		return "paid"
	case StatusInTransit:
		return "in_transit"
	case StatusAwaitingReceipt:
		return "awaiting_receipt"
	case StatusAcceptance:
		return "acceptance"
	case StatusToStock:
		return "to_stock"
	case StatusReserve:
		return "reserve"
	case StatusAssembly:
		return "assembly"
	case StatusPrepared, StatusAssembled:
		return "ready_to_ship"
	case StatusShipped:
		return "shipped"
	case StatusReturn:
		return "return"
	case StatusDone, StatusFinished:
		return "closed"
	}
	return string(s)
}

// StatusFromAPICode — значение 1С по коду API (первое значение группы statusEnum).
func StatusFromAPICode(code string) (Status, bool) {
	switch code {
	case "new":
		return StatusDraft, true
	case "in_work":
		return StatusInWork, true
	case "partially_ordered":
		return StatusPartiallyOrdered, true
	case "ordered":
		return StatusOrdered, true
	case "paid":
		return StatusPaid, true
	case "in_transit":
		return StatusInTransit, true
	case "awaiting_receipt":
		return StatusAwaitingReceipt, true
	case "acceptance":
		return StatusAcceptance, true
	case "to_stock":
		return StatusToStock, true
	case "reserve":
		return StatusReserve, true
	case "assembly":
		return StatusAssembly, true
	case "ready_to_ship":
		return StatusPrepared, true
	case "shipped":
		return StatusShipped, true
	case "return":
		return StatusReturn, true
	case "closed":
		return StatusDone, true
	case "locked_background":
		return StatusLockedBgJob, true
	}
	return "", false
}

// Role — роль пользователя в API (published language), 7 значений.
// Введена в Step 2a: матрица прав, FSM и команды агрегата сравнивают роли типом, а не строкой.
type Role string

const (
	RoleManager       Role = "manager"
	RoleSupply        Role = "supply"
	RoleStorekeeper   Role = "storekeeper"
	RoleChiefMechanic Role = "chief_mechanic"
	RoleAdmin         Role = "admin"
	RoleSupplier      Role = "supplier"
	RoleClient        Role = "client"
)

// RoleByEnum — роль интерфейса 1С (Арм_РолиИнтерфейса) → роль API.
// Это перевод между двумя внешними языками: в Step 5a переезжает в adapters/onec.
var RoleByEnum = map[string]Role{"Менеджер": RoleManager, "Снабжение": RoleSupply, "Кладовщик": RoleStorekeeper,
	"ГлавныйМеханик": RoleChiefMechanic, "Администратор": RoleAdmin, "Поставщик": RoleSupplier, "Клиент": RoleClient}

// EnumByRole — обратное соответствие.
var EnumByRole = func() map[string]string {
	m := map[string]string{}
	for k, v := range RoleByEnum {
		m[string(v)] = k
	}
	return m
}()

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func joinQuoted(list []string) string { return "«" + strings.Join(list, "», «") + "»" }
