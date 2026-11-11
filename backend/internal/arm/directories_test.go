package arm

import (
	"context"
	"testing"
)

// Справочники меняет только администратор: проверка роли выполняется до обращения к БД,
// поэтому тесты не требуют базы (как и brands_test.go).
func TestDirectoryEditRoles(t *testing.T) {
	s := &Service{}
	for _, role := range []string{"manager", "supply", "storekeeper", "chief_mechanic", "client", "supplier"} {
		a := Actor{Role: role}
		if _, err := s.DirectorySave(context.Background(), a, "zones", "", map[string]any{"code": "Z9", "name": "Зона"}); AsProblem(err).Status != 403 {
			t.Fatalf("роль %s: DirectorySave ожидался 403, получено %v", role, err)
		}
		if _, err := s.DirectorySave(context.Background(), a, "zones", "c2000000-0000-0000-0000-000000000001", map[string]any{"name": "Зона"}); AsProblem(err).Status != 403 {
			t.Fatalf("роль %s: DirectorySave (изменение) ожидался 403, получено %v", role, err)
		}
		if _, err := s.DirectoryDelete(context.Background(), a, "zones", "c2000000-0000-0000-0000-000000000001", false); AsProblem(err).Status != 403 {
			t.Fatalf("роль %s: DirectoryDelete ожидался 403, получено %v", role, err)
		}
	}
}

// Неизвестный справочник — 404 до обращения к БД.
func TestDirectoryUnknown(t *testing.T) {
	s := &Service{}
	a := Actor{Role: "admin"}
	for _, call := range []func() error{
		func() error { _, err := s.DirectorySave(context.Background(), a, "unknown", "", map[string]any{"name": "X"}); return err },
		func() error { _, err := s.DirectorySave(context.Background(), a, "nomenclature", "", map[string]any{"name": "X"}); return err },
		func() error {
			_, err := s.DirectoryDelete(context.Background(), a, "batches", "c2000000-0000-0000-0000-000000000001", false)
			return err
		},
	} {
		if p := AsProblem(call()); p == nil || p.Status != 404 {
			t.Fatalf("ожидался 404, получено %v", p)
		}
	}
}

// Типы полей и обязательные поля проверяются до обращения к БД.
func TestDirectoryValidation(t *testing.T) {
	s := &Service{}
	a := Actor{Role: "admin"}
	ctx := context.Background()
	cases := []struct {
		name  string
		dir   string
		id    string
		body  map[string]any
		field string
	}{
		{"зона без кода", "zones", "", map[string]any{"name": "Зона"}, "code"},
		{"зона без наименования", "zones", "", map[string]any{"code": "Z9"}, "name"},
		{"пустой код", "zones", "", map[string]any{"code": "  ", "name": "Зона"}, "code"},
		{"порядок не число", "zones", "", map[string]any{"code": "Z9", "name": "Зона", "sort": "первый"}, "sort"},
		{"ячейка без склада", "cells", "", map[string]any{"code": "A-01"}, "warehouseId"},
		{"вместимость не число", "cells", "", map[string]any{"code": "A-01", "warehouseId": "44444444-4444-4444-4444-444444444401", "capacity": "много"}, "capacity"},
		{"склад не uuid", "cells", "", map[string]any{"code": "A-01", "warehouseId": "склад"}, "warehouseId"},
		{"дата договора не дата", "contracts", "", map[string]any{"name": "Д-1", "counterpartyId": "66666666-6666-6666-6666-666666666601", "contractDate": "31.12.2026"}, "contractDate"},
		{"контрагент договора не uuid", "contracts", "", map[string]any{"name": "Д-1", "counterpartyId": "иванов"}, "counterpartyId"},
		{"недействителен не да/нет", "counterparties", "", map[string]any{"name": "ООО", "inactive": "может быть"}, "inactive"},
		{"договор без контрагента", "contracts", "", map[string]any{"name": "Д-1"}, "counterpartyId"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := s.DirectorySave(ctx, a, tc.dir, tc.id, tc.body)
			p := AsProblem(err)
			if p == nil || p.Status != 400 {
				t.Fatalf("ожидался 400, получено %v", err)
			}
			if tc.field != "" && p.Field != tc.field {
				t.Fatalf("поле %q, хотим %q (%v)", p.Field, tc.field, err)
			}
		})
	}
}

// Справочники с CRUD описаны и доступны по именам страницы «Справочники».
func TestDirectoryDefsComplete(t *testing.T) {
	for _, name := range []string{"counterparties", "contracts", "service-types", "payment-forms", "units", "warehouses", "zones", "cells"} {
		d, ok := dirDefs[name]
		if !ok {
			t.Fatalf("нет описания справочника %s", name)
		}
		if d.table == "" || d.item == "" || len(d.fields) == 0 || d.list == nil {
			t.Fatalf("справочник %s описан неполно: %+v", name, d)
		}
		for _, req := range d.required {
			if _, ok := d.fields[req]; !ok {
				t.Fatalf("справочник %s: обязательное поле %s не описано", name, req)
			}
		}
	}
}
