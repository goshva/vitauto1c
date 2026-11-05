package application

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestParseImportSheetXLSX(t *testing.T) {
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	rows := [][]string{
		{"Вспомогательные", "В заказ и отгрузка"},                  // баннер шаблона — не заголовок
		{"К1Срочность (ФАКТ)", "К2Машина ГРЗ (ФАКТ)", "К4Наименование (ФАКТ)", "К5Артикул (ФАКТ)", "К6Кол-во (ФАКТ)"},
		{"срочно", "А123ВС77", "Фильтр масляный", "0K012-1501", "2,00"},
		{"", "Х100КН199", "Колодки тормозные", "BP-8823", "4"},
		{"", "", "", "", ""},
		{"", "", "Колодки тормозные", "BP-8823", "4"}, // полный дубль строки 2 — должен быть пропущен
	}
	for i, r := range rows {
		for j, v := range r {
			cell, _ := excelize.CoordinatesToCellName(j+1, i+1)
			if err := f.SetCellValue(sheet, cell, v); err != nil {
				t.Fatal(err)
			}
		}
	}
	data, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}

	got, err := ParseImportSheet("лист.xlsx", data.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Rows) != 2 {
		t.Fatalf("строк = %d, хотим 2 (дубль и пустая пропущены): %+v", len(got.Rows), got.Rows)
	}
	r0 := got.Rows[0]
	if r0.Article != "0K012-1501" || r0.Quantity != "2" || r0.Plate != "А123ВС77" || r0.Urgency != "срочно" {
		t.Errorf("строка 1 разобрана неверно: %+v", r0)
	}
	if len(got.Warnings) == 0 || !strings.Contains(got.Warnings[0], "дубль") {
		t.Errorf("ожидается предупреждение о дубле, получили %v", got.Warnings)
	}
}

func TestParseImportSheetCSV(t *testing.T) {
	csvData := "К4Наименование;К5Артикул;К6Кол-во;V5№ заказ внешний наш\n" +
		"Ремень ГРМ;12345;1;\n" +
		"Ролик;67890;2,5;4711\n"
	got, err := ParseImportSheet("лист.csv", []byte(csvData))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Rows) != 2 {
		t.Fatalf("строк = %d, хотим 2", len(got.Rows))
	}
	if got.Rows[0].Quantity != "1" {
		t.Errorf("количество = %q, хотим \"1\"", got.Rows[0].Quantity)
	}
	if got.Rows[1].Quantity != "2.5" {
		t.Errorf("количество = %q, хотим \"2.5\" (запятая → точка)", got.Rows[1].Quantity)
	}
	if got.Rows[1].ClientNumber != "4711" {
		t.Errorf("номер клиента = %q, хотим 4711", got.Rows[1].ClientNumber)
	}
	// Пустое количество → 1 + предупреждение
	if got.Rows[0].Quantity != "1" {
		t.Errorf("пустое количество не заменено")
	}
}

func TestParseImportSheetNoHeader(t *testing.T) {
	_, err := ParseImportSheet("мусор.csv", []byte("a;b\n1;2\n"))
	if err == nil || !strings.Contains(err.Error(), "заголовков") {
		t.Fatalf("ожидаемая ошибка про заголовки, получили %v", err)
	}
}

// Реальный файл проекта — проверка, что коды колонок шаблона совпадают с парсером.
func TestParseRealTemplate(t *testing.T) {
	path := filepath.Join("..", "..", "..", "Шаблон для   деталей.xlsx")
	if _, err := os.Stat(path); err != nil {
		t.Skip("шаблон не найден:", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseImportSheet(filepath.Base(path), data)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Rows) == 0 {
		t.Fatal("в реальном шаблоне не разобралось ни одной строки")
	}
}
