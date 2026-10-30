package onec

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// EnumIndex — UUID значения перечисления -> "Перечисление.X.Имя" (из sys.enum_value).
type EnumIndex map[uuid.UUID]string

// skipField — служебные поля платформы, которые не несут данных (разделение данных всегда 0).
func skipField(name string) bool {
	return name == "ОбластьДанныхОсновныеДанные"
}

// Decoder переводит строку таблицы хранения 1С (to_jsonb) в данные с именами 1С: ссылки — UUID, перечисления —
// «Перечисление.X.Имя», составные типы — {"type": объект, "id": UUID} или примитив. Используется архивом legacy и сверкой.
type Decoder struct {
	Meta  *Meta
	Enums EnumIndex
}

// ParseRow читает to_jsonb с сохранением точности чисел.
func ParseRow(b []byte) (map[string]any, error) {
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var m map[string]any
	return m, d.Decode(&m)
}

// Row — поля строки таблицы storage по именам 1С.
func (d *Decoder) Row(storage string, raw map[string]any) map[string]any {
	t := d.Meta.Tables[strings.ToLower(storage)]
	out := map[string]any{}
	if t == nil { // нет описания — сырые поля
		for k, v := range raw {
			out[k] = v
		}
		return out
	}
	groups := map[string][]string{}
	var order []string
	for _, f := range t.Fields {
		name := f[1]
		if name == "" {
			name = f[0]
		}
		if skipField(name) {
			continue
		}
		if _, ok := groups[name]; !ok {
			order = append(order, name)
		}
		groups[name] = append(groups[name], strings.ToLower(f[0]))
	}
	for _, name := range order {
		cols := groups[name]
		if len(cols) == 1 {
			out[name] = d.scalar(cols[0], raw[cols[0]])
		} else {
			out[name] = d.composite(cols, raw)
		}
	}
	return out
}

func (d *Decoder) scalar(col string, v any) any {
	s, ok := v.(string)
	if !ok || !strings.HasPrefix(s, `\x`) {
		return v
	}
	if (strings.HasSuffix(col, "rref") || col == "_predefinedid") && len(s) == 34 {
		u, ok, err := UUIDFromHex(s)
		if err != nil || !ok {
			return nil
		}
		if e, ok := d.Enums[u]; ok {
			return e
		}
		return u.String()
	}
	return s
}

func suffixCol(cols []string, sfx string) string {
	for _, c := range cols {
		if strings.HasSuffix(c, sfx) {
			return c
		}
	}
	return ""
}

func (d *Decoder) composite(cols []string, raw map[string]any) any {
	tp, rt, rr := suffixCol(cols, "_type"), suffixCol(cols, "rtref"), suffixCol(cols, "rrref")
	ref := func() any {
		if rr == "" {
			return nil
		}
		id := d.scalar(rr, raw[rr])
		// пустая ссылка составного поля сохраняет тип: «пустая ссылка Справочник.X» ≠ «пустая ссылка Справочник.Y»
		if s, ok := id.(string); ok && strings.HasPrefix(s, "Перечисление.") {
			return s
		}
		return map[string]any{"type": d.typeName(raw[rt]), "id": id}
	}
	if tp == "" {
		return ref()
	}
	switch raw[tp] {
	case `\x08`:
		return ref()
	case `\x02`:
		return raw[suffixCol(cols, "_l")]
	case `\x03`:
		return raw[suffixCol(cols, "_n")]
	case `\x04`:
		return raw[suffixCol(cols, "_t")]
	case `\x05`:
		return raw[suffixCol(cols, "_s")]
	default:
		return nil
	}
}

// typeName — объект метаданных по _RTRef (номер типа ссылки).
func (d *Decoder) typeName(v any) string {
	s, _ := v.(string)
	if len(s) != 10 {
		return s
	}
	n, err := strconv.ParseUint(s[2:], 16, 32)
	if err != nil {
		return s
	}
	if t := d.Meta.TypeNo[int(n)]; t != nil {
		return ObjectOf(t.Meta)
	}
	return "type:" + strconv.FormatUint(n, 10)
}

// Canonical — канонический JSON (ключи по алфавиту, числа как в источнике) и его sha256.
func Canonical(v any) ([]byte, string) {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return b, hex.EncodeToString(h[:])
}
