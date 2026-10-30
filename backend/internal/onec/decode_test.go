package onec

import (
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

var testStatus = uuid.MustParse("11111111-2222-3333-4444-555555555555")

func testDecoder() *Decoder {
	m := &Meta{Tables: map[string]*MetaTable{}, TypeNo: map[int]*MetaTable{}}
	m.Tables["_inforg1"] = &MetaTable{Meta: "РегистрСведений.Тест", Storage: "_InfoRg1", Fields: [][2]string{
		{"_Fld2RRef", "Номенклатура"}, {"_Fld3_TYPE", "Значение"}, {"_Fld3_RTRef", "Значение"}, {"_Fld3_RRRef", "Значение"},
		{"_Fld3_N", "Значение"}, {"_Fld4", "ОбластьДанныхОсновныеДанные"}, {"_Fld5RRef", "Статус"},
	}}
	m.TypeNo[368] = &MetaTable{Meta: "Справочник.Номенклатура", Storage: "_Reference368X1"}
	return &Decoder{Meta: m, Enums: EnumIndex{testStatus: "Перечисление.Арм_СтатусыАРМ.ВРаботе"}}
}

// bytea так, как его отдаёт to_jsonb: строка \x + hex
func bx(h string) string { return `\x` + h }

// rowJSON — строка таблицы через JSON, как из PostgreSQL (числа — json.Number)
func rowJSON(t *testing.T, m map[string]any) map[string]any {
	b, _ := json.Marshal(m)
	r, err := ParseRow(b)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestDecodeRow(t *testing.T) {
	raw := rowJSON(t, map[string]any{
		"_fld2rref": bx(sampleHex), "_fld3_type": bx("08"), "_fld3_rtref": bx("00000170"),
		"_fld3_rrref": bx("00000000000000000000000000000000"), "_fld3_n": 0, "_fld4": 0,
		"_fld5rref": bx(hex.EncodeToString(IDRRefFromUUID(testStatus))),
	})
	row := testDecoder().Row("_InfoRg1", raw)
	if row["Номенклатура"] != sampleUUID {
		t.Fatalf("ссылка: %v", row["Номенклатура"])
	}
	v, ok := row["Значение"].(map[string]any)
	if !ok || v["type"] != "Справочник.Номенклатура" || v["id"] != nil {
		t.Fatalf("пустая ссылка составного типа должна сохранять тип: %#v", row["Значение"])
	}
	if _, ok := row["ОбластьДанныхОсновныеДанные"]; ok {
		t.Fatal("служебное поле разделения данных не переносится")
	}
	if row["Статус"] != "Перечисление.Арм_СтатусыАРМ.ВРаботе" {
		t.Fatalf("перечисление: %v", row["Статус"])
	}
}

func TestDecodeNumbersExact(t *testing.T) {
	raw, err := ParseRow([]byte(`{"_fld3_type":"\\x03","_fld3_n":2417.43}`))
	if err != nil {
		t.Fatal(err)
	}
	v := testDecoder().Row("_InfoRg1", raw)["Значение"]
	if n, ok := v.(json.Number); !ok || n.String() != "2417.43" {
		t.Fatalf("число должно сохраняться без потери точности: %#v", v)
	}
	_, h1 := Canonical(map[string]any{"b": 1, "a": 2})
	_, h2 := Canonical(map[string]any{"a": 2, "b": 1})
	if h1 != h2 {
		t.Fatal("канонический JSON не зависит от порядка ключей")
	}
}
