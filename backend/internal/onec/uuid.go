// Package onec — слой защиты от понятий 1С (anti-corruption layer, docs/migration/ddd/01-strategic.md):
// перевод ссылок, перечислений и составных типов из таблиц хранения 1С в значения новой модели.
package onec

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// emptyRef — пустая ссылка 1С (16 нулевых байт).
const emptyRef = "00000000000000000000000000000000"

// UUIDFromIDRRef переводит _IDRRef (16 байт в порядке хранения 1С) в UUID, который 1С показывает как Ref_Key.
// Порядок проверен на vitauto_dev (гейт G0.3): hex[24:32]-hex[20:24]-hex[16:20]-hex[0:4]-hex[4:16].
// Пустая ссылка — uuid.Nil и ok=false.
func UUIDFromIDRRef(b []byte) (uuid.UUID, bool, error) {
	if len(b) != 16 {
		return uuid.Nil, false, fmt.Errorf("_IDRRef: ожидается 16 байт, получено %d", len(b))
	}
	h := hex.EncodeToString(b)
	if h == emptyRef {
		return uuid.Nil, false, nil
	}
	u, err := uuid.Parse(h[24:32] + "-" + h[20:24] + "-" + h[16:20] + "-" + h[0:4] + "-" + h[4:16])
	return u, err == nil, err
}

// UUIDFromHex — то же для hex-строки вида "\\x8dd6…" (так to_jsonb отдаёт bytea).
func UUIDFromHex(s string) (uuid.UUID, bool, error) {
	b, err := hex.DecodeString(strings.TrimPrefix(s, `\x`))
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("_IDRRef %q: %w", s, err)
	}
	return UUIDFromIDRRef(b)
}

// IDRRefFromUUID — обратный перевод (для выборочной сверки и обратного переноса export-onec).
func IDRRefFromUUID(u uuid.UUID) []byte {
	h := strings.ReplaceAll(u.String(), "-", "")
	b, _ := hex.DecodeString(h[16:20] + h[20:32] + h[12:16] + h[8:12] + h[0:8])
	return b
}

// Пространства имён детерминированных UUID (план, раздел 5.2). Менять нельзя: повторный перенос должен давать те же id.
var (
	NSTabular  = uuid.MustParse("6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61") // строки табличных частей: <id документа>:<НомерСтроки>
	NSRegister = uuid.MustParse("6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a62") // записи регистров без ссылки: <регистр>:<ключ>
	NSArm      = uuid.MustParse("6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a63") // ИдентификаторЗаписи строки АРМ, если это не GUID
)

// TabularID — id строки табличной части.
func TabularID(owner uuid.UUID, lineNo int64) uuid.UUID {
	return uuid.NewSHA1(NSTabular, []byte(fmt.Sprintf("%s:%d", owner, lineNo)))
}

// RegisterID — id записи регистра по имени регистра и ключу записи.
func RegisterID(register, key string) uuid.UUID {
	return uuid.NewSHA1(NSRegister, []byte(register+":"+key))
}

// ArmLineID — id строки АРМ: сам ИдентификаторЗаписи, если это GUID, иначе uuidv5.
func ArmLineID(recordID string) uuid.UUID {
	if u, err := uuid.Parse(strings.TrimSpace(recordID)); err == nil {
		return u
	}
	return uuid.NewSHA1(NSArm, []byte(recordID))
}
