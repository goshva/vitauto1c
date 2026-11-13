package domain

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Field — имя поля строки в ubiquitous language.
// Значение — имя поля регистра 1С, как его передаёт PWA в PATCH /lines/{lineId}
// (docs/migration/ddd/02-tactical.md §2.1, команда ChangeField).
//
// Это НЕ столбец БД: отображение Field → столбец arm.line живёт в
// adapters/postgres/field_map_gen.go, а вид значения — в Fields (fields_gen.go).
type Field string

// Поля, участвующие в правилах домена: формулы FR-7..9, инварианты, команды агрегата.
// Остальные 60+ полей регистра домен не моделирует (Line — частичная модель,
// полный REST-формат отдаёт представление arm.line_api, см. line.go:34).
const (
	FieldQuantity        Field = "Количество"
	FieldCostPrice       Field = "СебестоимостьЕдиницы"
	FieldCostSum         Field = "Себестоимость"
	FieldSalePrice       Field = "Цена"
	FieldCoeff           Field = "Коэффициент"
	FieldPriceChangeType Field = "ТипИзмененияЦены"
	FieldNormHours       Field = "КоличествоНормаЧас"
	FieldRRC             Field = "РРЦ"
	FieldSignedOriginal  Field = "ДокументПодписанОригинал"
	FieldMarked          Field = "ОтметкаСтроки"
	FieldStatus          Field = "СтатусСтроки"
	FieldDeleted         Field = "Удаление"
	FieldOperation       Field = "ВидОперации"
	FieldNomenclature    Field = "Номенклатура"
	FieldBatch           Field = "Партия"
	FieldSupplier        Field = "Поставщик"
	FieldCustomer        Field = "Покупатель"
	FieldContract        Field = "Договор"
	FieldOrder           Field = "ДокументЗаказПокупателя"
	FieldSupplierOrder   Field = "ДокументЗаказПоставщика"
	FieldReceipt         Field = "ДокументПриходнаяНакладная"
	FieldLinkKey         Field = "КлючСвязиСтрок"
	FieldManualEdit      Field = "РучнаяПравка"
	FieldManualBatch     Field = "РучнаяПравкаПартии"
	FieldManualSplit     Field = "РучноеРазделениеСУчетомПартий"
	FieldFactName        Field = "НоменклатураКлиента"
	FieldFactArticle     Field = "АртикулКлиента"
	FieldComment         Field = "КомментарийКСтроке"
	FieldComment2        Field = "КомментарийКСтроке2"
	FieldClientOrderNo   Field = "НомерЗаказаКлиента"
	FieldShipmentDate    Field = "ДатаОтгрузки"
	FieldAssemblySent    Field = "ДатаОтправкиНаСборку"
	FieldMarkedBy        Field = "АвторСтроки"
)

// FieldInfo — столбец arm.line и вид значения (ref, enum, date, number, bool, text).
// Заполняется генератором (fields_gen.go) из docs/migration/storage-map.json.
type FieldInfo struct {
	Column string
	Kind   string
}

// setters — применение значения к агрегату. Явная таблица, без reflection
// (decision Q9: домен получает типизированные поля, а не map[string]any).
//
// Таблица покрывает ровно те поля, которые моделирует Line. Для остальных
// ChangeField возвращает ErrFieldReadonly — это граница агрегата, а не пробел:
// расширять её нужно вместе с полями Line, а не «на всякий случай».
var setters = map[Field]func(*Line, any) error{
	// Служебные и связующие
	FieldLinkKey:       setText(func(l *Line) *string { return &l.LinkKey }),
	FieldClientOrderNo: setText(func(l *Line) *string { return &l.ClientOrderNumber }),
	FieldFactName:      setText(func(l *Line) *string { return &l.FactName }),
	FieldFactArticle:   setText(func(l *Line) *string { return &l.FactArticle }),
	FieldComment:       setText(func(l *Line) *string { return &l.Comment }),
	FieldComment2:      setText(func(l *Line) *string { return &l.Comment2 }),
	FieldOperation:     setEnum(func(l *Line) *Operation { return &l.Operation }),
	FieldStatus:        setEnum(func(l *Line) *Status { return &l.Status }),

	// Отметки и удаление
	FieldMarked:         setBool(func(l *Line) *bool { return &l.Marked }),
	FieldDeleted:        setBool(func(l *Line) *bool { return &l.Deleted }),
	FieldSignedOriginal: setBool(func(l *Line) *bool { return &l.SignedOriginal }),
	FieldManualEdit:     setBool(func(l *Line) *bool { return &l.ManualEdit }),
	FieldManualBatch:    setBool(func(l *Line) *bool { return &l.ManualBatch }),
	FieldManualSplit:    setBool(func(l *Line) *bool { return &l.ManualSplit }),
	FieldMarkedBy:       setUUIDPtr(func(l *Line) **uuid.UUID { return &l.MarkedBy }),

	// Ссылки
	FieldNomenclature:  setUUIDPtr(func(l *Line) **uuid.UUID { return &l.Nomenclature }),
	FieldBatch:         setUUIDPtr(func(l *Line) **uuid.UUID { return &l.Batch }),
	FieldSupplier:      setUUIDPtr(func(l *Line) **uuid.UUID { return &l.Supplier }),
	FieldCustomer:      setUUIDPtr(func(l *Line) **uuid.UUID { return &l.Customer }),
	FieldContract:      setUUIDPtr(func(l *Line) **uuid.UUID { return &l.Contract }),
	FieldOrder:         setUUIDPtr(func(l *Line) **uuid.UUID { return &l.Order }),
	FieldSupplierOrder: setUUIDPtr(func(l *Line) **uuid.UUID { return &l.SupplierOrder }),
	FieldReceipt:       setUUIDPtr(func(l *Line) **uuid.UUID { return &l.Receipt }),

	// Числа: количества и деньги
	FieldQuantity:  setFloat(func(l *Line) *float64 { return &l.Quantity }),
	FieldCostPrice: setFloat(func(l *Line) *float64 { return &l.CostPrice }),
	FieldSalePrice: setFloat(func(l *Line) *float64 { return &l.SalePrice }),
	FieldCoeff:     setFloat(func(l *Line) *float64 { return &l.Coeff }),
	FieldNormHours: setFloat(func(l *Line) *float64 { return &l.NormHours }),
	FieldRRC:       setFloat(func(l *Line) *float64 { return &l.RRC }),
	FieldCostSum:   setFloat(func(l *Line) *float64 { return &l.CostSum }),
	FieldPriceChangeType: func(l *Line, v any) error {
		n, err := asInt(v)
		if err != nil {
			return err
		}
		l.PriceChangeType = n
		return nil
	},

	// Даты
	FieldShipmentDate: setTimePtr(func(l *Line) **time.Time { return &l.ShipmentDate }),
	FieldAssemblySent: setTimePtr(func(l *Line) **time.Time { return &l.AssemblySent }),
}

// settersFor — доступ к таблице применения значений (для тестов и генератора).
func settersFor(f Field) (func(*Line, any) error, bool) {
	set, ok := setters[f]
	return set, ok
}

// ——— Конвертеры значений ———
//
// Все возвращают ошибку типа, а не молча приводят к нулю: PATCH с числом в текстовое
// поле должен давать 400, а не портить строку.

func asFloat(v any) (float64, error) {
	switch x := v.(type) {
	case float64:
		return x, nil
	case float32:
		return float64(x), nil
	case int:
		return float64(x), nil
	case int64:
		return float64(x), nil
	case nil:
		return 0, nil
	}
	return 0, fmt.Errorf("ожидалось число, получено %T", v)
}

func asInt(v any) (int, error) {
	switch x := v.(type) {
	case int:
		return x, nil
	case int64:
		return int(x), nil
	case float64:
		return int(x), nil
	case nil:
		return 0, nil
	}
	return 0, fmt.Errorf("ожидалось целое, получено %T", v)
}

func asBool(v any) (bool, error) {
	if b, ok := v.(bool); ok {
		return b, nil
	}
	if v == nil {
		return false, nil
	}
	return false, fmt.Errorf("ожидалось логическое, получено %T", v)
}

func asText(v any) (string, error) {
	if s, ok := v.(string); ok {
		return s, nil
	}
	if v == nil {
		return "", nil
	}
	return "", fmt.Errorf("ожидалась строка, получено %T", v)
}

func asUUIDPtr(v any) (*uuid.UUID, error) {
	switch x := v.(type) {
	case uuid.UUID:
		u := x
		return &u, nil
	case *uuid.UUID:
		return x, nil
	case string:
		if x == "" {
			return nil, nil
		}
		u, err := uuid.Parse(x)
		if err != nil {
			return nil, fmt.Errorf("ожидался UUID: %w", err)
		}
		return &u, nil
	case nil:
		return nil, nil
	}
	return nil, fmt.Errorf("ожидалась ссылка UUID, получено %T", v)
}

func asTimePtr(v any) (*time.Time, error) {
	switch x := v.(type) {
	case time.Time:
		t := x
		return &t, nil
	case *time.Time:
		return x, nil
	case string:
		if x == "" {
			return nil, nil
		}
		t, err := time.Parse(time.RFC3339, x)
		if err != nil {
			return nil, fmt.Errorf("ожидалась дата RFC3339: %w", err)
		}
		return &t, nil
	case nil:
		return nil, nil
	}
	return nil, fmt.Errorf("ожидалась дата, получено %T", v)
}

// ——— Конструкторы сеттеров ———

func setFloat(ptr func(*Line) *float64) func(*Line, any) error {
	return func(l *Line, v any) error {
		x, err := asFloat(v)
		if err != nil {
			return err
		}
		*ptr(l) = x
		return nil
	}
}

func setBool(ptr func(*Line) *bool) func(*Line, any) error {
	return func(l *Line, v any) error {
		x, err := asBool(v)
		if err != nil {
			return err
		}
		*ptr(l) = x
		return nil
	}
}

func setText(ptr func(*Line) *string) func(*Line, any) error {
	return func(l *Line, v any) error {
		x, err := asText(v)
		if err != nil {
			return err
		}
		*ptr(l) = x
		return nil
	}
}

func setEnum[T ~string](ptr func(*Line) *T) func(*Line, any) error {
	return func(l *Line, v any) error {
		x, err := asText(v)
		if err != nil {
			return err
		}
		*ptr(l) = T(x)
		return nil
	}
}

func setUUIDPtr(ptr func(*Line) **uuid.UUID) func(*Line, any) error {
	return func(l *Line, v any) error {
		x, err := asUUIDPtr(v)
		if err != nil {
			return err
		}
		*ptr(l) = x
		return nil
	}
}

func setTimePtr(ptr func(*Line) **time.Time) func(*Line, any) error {
	return func(l *Line, v any) error {
		x, err := asTimePtr(v)
		if err != nil {
			return err
		}
		*ptr(l) = x
		return nil
	}
}

// round2 — округление до копеек, как arm.round2 (arm/arm.go:299-304) и application.round2.
// Точное совпадение алгоритма обязательно: расхождение даст разные суммы на write- и read-стороне.
// В Step 11 переезжает в money.go вместе с типом Money.
func round2(x float64) float64 {
	if x < 0 {
		return -round2(-x)
	}
	return float64(int64(x*100+0.5000001)) / 100
}
