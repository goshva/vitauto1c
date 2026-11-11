package arm

import "testing"

// ФТ v2 п. 13: дополнительный реквизит строки «ДопПризнак» (бывшая колонка AD) — флажок.
// Поле зарегистрировано поверх сгенерированной карты полей и есть в матрице роли.
func TestExtraFlagField(t *testing.T) {
	f, ok := Fields["ДопПризнак"]
	if !ok {
		t.Fatal("поле «ДопПризнак» не зарегистрировано в Fields")
	}
	if f.Column != "extra_flag" || f.Kind != "bool" {
		t.Fatalf("ДопПризнак: колонка %q, вид %q — ожидалось extra_flag/bool", f.Column, f.Kind)
	}
	for _, role := range []string{"manager", "storekeeper", "admin", "supply"} {
		col, ok := columnFor(role, "ДопПризнак")
		if !ok {
			t.Fatalf("роль %s: в матрице нет колонки «ДопПризнак»", role)
		}
		if col.ID != "extra_flag" || col.DataType != "checkbox" {
			t.Fatalf("роль %s: колонка %s, тип %q — ожидалось extra_flag/checkbox", role, col.ID, col.DataType)
		}
		if len(col.Rights) != len(MatrixFor(role).Statuses) {
			t.Fatalf("роль %s: маска прав длиной %d, статусов %d", role, len(col.Rights), len(MatrixFor(role).Statuses))
		}
	}
}

// ФТ v2 п. 5: профиль «Кладовщик» — без цен закупки и себестоимости (и без оплаты):
// права на эти колонки закрыты во всех статусах.
func TestStorekeeperNoCost(t *testing.T) {
	m := MatrixFor("storekeeper")
	byID := map[string]MatrixColumn{}
	for _, c := range m.Columns {
		byID[c.ID] = c
	}
	for _, id := range []string{"price", "sum", "paid_status", "invoice_number", "invoice_date"} {
		c, ok := byID[id]
		if !ok {
			t.Fatalf("у кладовщика нет колонки %s", id)
		}
		for i, ch := range c.Rights {
			if ch != '.' {
				t.Fatalf("%s (%s): право %q в статусе %s — у кладовщика должно быть запрещено", id, c.Title, string(ch), m.Statuses[i])
			}
		}
	}
	// Складские колонки движения у кладовщика остаются доступными.
	for _, id := range []string{"extra_flag", "comment"} {
		c, ok := byID[id]
		if !ok {
			t.Fatalf("у кладовщика нет колонки %s", id)
		}
		if c.Rights == "" || c.Rights == "..............." {
			t.Fatalf("%s (%s): у кладовщика колонка закрыта целиком", id, c.Title)
		}
	}
}
