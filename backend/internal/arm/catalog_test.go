package arm

import (
	"context"
	"testing"
)

// ТЗ п.19: карточка товара принимает «Наименование для печати» (fullName) и «Код поставщика» (extCode).
// Проверка роли в CatalogSave выполняется до обращения к БД, поэтому тест без базы.
func TestCatalogSaveRole(t *testing.T) {
	s := &Service{}
	id := "c2000000-0000-0000-0000-000000000001"
	for _, role := range []string{"supply", "chief_mechanic", "client", "supplier"} {
		_, err := s.CatalogSave(context.Background(), Actor{Role: role}, "goods", id, map[string]any{"name": "Товар"})
		if p := AsProblem(err); p == nil || p.Status != 403 {
			t.Fatalf("роль %s: CatalogSave ожидался 403, получено %v", role, err)
		}
	}
	// Разрешённые роли (admin, manager, storekeeper) отсекаются уже внутри БД-транзакции,
	// поэтому проверка 403 для них — в интеграционных тестах с базой.
}

// ТЗ п.15: «Вычеркнуть» строку может только администратор — проверка до БД.
func TestStrikeLineRole(t *testing.T) {
	s := &Service{}
	id := "c2000000-0000-0000-0000-000000000001"
	for _, role := range []string{"manager", "storekeeper", "supply", "chief_mechanic", "client", "supplier"} {
		if err := s.StrikeLine(context.Background(), Actor{Role: role}, id); AsProblem(err).Status != 403 {
			t.Fatalf("роль %s: StrikeLine ожидался 403, получено %v", role, err)
		}
	}
}
