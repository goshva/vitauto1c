package arm

import (
	"reflect"
	"testing"
)

// Быстрый фильтр: путь уходит параметром (string_to_array), значение сравнивается по типу.
func TestQuickPredicate(t *testing.T) {
	cases := []struct {
		name      string
		path      string
		kind      string
		value     string
		wantPred  string
		wantArgs  []any
		wantError bool
	}{
		{
			name: "текст: контрагент по имени",
			path: "customer.name", kind: "text", value: "ИП Иванов И.И.",
			wantPred: "(a.api #>> string_to_array(?, '.')) = ?",
			wantArgs: []any{"customer.name", "ИП Иванов И.И."},
		},
		{
			name: "статус по коду",
			path: "status", kind: "text", value: "in_work",
			wantPred: "(a.api #>> string_to_array(?, '.')) = ?",
			wantArgs: []any{"status", "in_work"},
		},
		{
			name: "дата: русский формат -> ISO",
			path: "shipmentDate", kind: "date", value: "12.03.2026",
			wantPred: "(a.api #>> string_to_array(?, '.')) = ?",
			wantArgs: []any{"shipmentDate", "2026-03-12"},
		},
		{
			name: "число: пробелы и запятая",
			path: "quantity", kind: "number", value: "1 234,5",
			wantPred: "(a.api #>> string_to_array(?, '.'))::numeric = ?::numeric",
			wantArgs: []any{"quantity", "1234.5"},
		},
		{
			name: "bool: галка",
			path: "signedOriginal", kind: "bool", value: "✓",
			wantPred: "(a.api #>> string_to_array(?, '.'))::boolean = ?::boolean",
			wantArgs: []any{"signedOriginal", "true"},
		},
		{
			name: "bool: пусто",
			path: "signedOriginal", kind: "bool", value: "",
			wantPred: "(a.api #>> string_to_array(?, '.'))::boolean = ?::boolean",
			wantArgs: []any{"signedOriginal", "false"},
		},
		{
			name: "дата не разобралась — сравниваем как текст",
			path: "shipmentDate", kind: "date", value: "кривая дата",
			wantPred: "(a.api #>> string_to_array(?, '.')) = ?",
			wantArgs: []any{"shipmentDate", "кривая дата"},
		},
		{
			name: "путь с недопустимым сегментом",
			path: "customer; drop", kind: "text", value: "x", wantError: true,
		},
		{
			name: "путь слишком глубокий",
			path: "a.b.c.d.e", kind: "text", value: "x", wantError: true,
		},
		{
			name: "пустой путь",
			path: "", kind: "text", value: "x", wantError: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pred, args, err := quickPredicate(c.path, c.kind, c.value)
			if c.wantError {
				if err == nil || AsProblem(err).Status != 400 {
					t.Fatalf("ожидалась ошибка 400, получено pred=%q args=%v err=%v", pred, args, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("неожиданная ошибка: %v", err)
			}
			if pred != c.wantPred {
				t.Fatalf("pred=%q, ожидалось %q", pred, c.wantPred)
			}
			if !reflect.DeepEqual(args, c.wantArgs) {
				t.Fatalf("args=%v, ожидалось %v", args, c.wantArgs)
			}
		})
	}
}

func TestFillPlaceholders(t *testing.T) {
	got := fillPlaceholders("(a.api #>> string_to_array(?, '.')) = ?", 3)
	want := "(a.api #>> string_to_array($3, '.')) = $4"
	if got != want {
		t.Fatalf("получено %q, ожидалось %q", got, want)
	}
}

func TestRuDateToISO(t *testing.T) {
	if v, ok := ruDateToISO("01.12.2026"); !ok || v != "2026-12-01" {
		t.Fatalf("получено %q/%v", v, ok)
	}
	for _, bad := range []string{"", "1.2.2026", "2026-12-01", "01/12/2026"} {
		if _, ok := ruDateToISO(bad); ok {
			t.Fatalf("%q не должно разбираться", bad)
		}
	}
}

func TestRuNumber(t *testing.T) {
	cases := map[string]string{"1 234,5": "1234.5", "42": "42", "1\u00a0000,25": "1000.25"}
	for in, want := range cases {
		got, ok := ruNumber(in)
		if !ok || got != want {
			t.Fatalf("%q -> %q/%v, ожидалось %q", in, got, ok, want)
		}
	}
	for _, bad := range []string{"", "abc", "1,2,3"} {
		if _, ok := ruNumber(bad); ok {
			t.Fatalf("%q не должно разбираться", bad)
		}
	}
}
