package arm

import (
	"context"
	"testing"
)

// Бренды: менять справочник может только администратор (ТЗ 2.2, НСИ ведёт админ).
// Проверка роли выполняется до обращения к БД, поэтому тест не требует базы.
func TestBrandEditRoles(t *testing.T) {
	s := &Service{}
	for _, role := range []string{"manager", "supply", "storekeeper", "chief_mechanic", "client", "supplier"} {
		_, err := s.BrandSave(context.Background(), Actor{Role: role}, "", map[string]any{"name": "X"})
		p := AsProblem(err)
		if p == nil || p.Status != 403 {
			t.Fatalf("роль %s: ожидался 403, получено %v", role, err)
		}
	}
	_, err := s.BrandDelete(context.Background(), Actor{Role: "manager"}, "b1000000-0000-0000-0000-000000000001", false)
	if p := AsProblem(err); p == nil || p.Status != 403 {
		t.Fatalf("BrandDelete: ожидался 403, получено %v", err)
	}
}

// Вложения: загружать фото могут менеджер, кладовщик, механик и администратор.
func TestAttachmentRoles(t *testing.T) {
	s := &Service{}
	for _, role := range []string{"supplier", "client"} {
		_, err := s.AttachmentCreate(context.Background(), Actor{Role: role}, "nomenclature", "77777777-7777-7777-7777-777777777701", "a.jpg", "image/jpeg", []byte{1})
		p := AsProblem(err)
		if p == nil || p.Status != 403 {
			t.Fatalf("роль %s: ожидался 403, получено %v", role, err)
		}
	}
}

// Вложения: проверка владельца и размера выполняется до БД.
func TestAttachmentValidation(t *testing.T) {
	s := &Service{}
	a := Actor{Role: "admin"}
	if p := AsProblem(mustErr(s.AttachmentCreate(context.Background(), a, "unknown", "77777777-7777-7777-7777-777777777701", "a.jpg", "image/jpeg", []byte{1}))); p == nil || p.Status != 400 {
		t.Fatalf("ownerType: ожидался 400")
	}
	if p := AsProblem(mustErr(s.AttachmentCreate(context.Background(), a, "nomenclature", "77777777-7777-7777-7777-777777777701", "a.txt", "text/plain", []byte("x")))); p == nil || p.Status != 400 {
		t.Fatalf("content-type: ожидался 400")
	}
}

func mustErr(_ any, err error) error { return err }
