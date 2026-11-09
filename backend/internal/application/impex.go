// impex.go — разбор файла листа покупателя (M1, ТЧИ1): .xlsx (excelize) и .csv.
// Колонки шаблона «Шаблон для деталей.xlsx» опознаются по коду в начале заголовка
// (К1Срочность, К2Машина ГРЗ, К3Территория, К4Наименование, К5Артикул, К6Кол-во, N0Кол-во*).
package application

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"

	"vitauto/backend/internal/arm"
)

// ImportRows — строки, разобранные из файла, + сводка для предпросмотра.
type ImportRows struct {
	Rows     []arm.ImportRow `json:"rows"`
	Warnings []string        `json:"warnings,omitempty"`
}

// headerMap — соответствие кода колонки шаблона → поле строки импорта.
var headerCols = []struct {
	prefix string // префикс кода в заголовке (без учёта регистра)
	field  string // ClientNumber|Urgency|Plate|Territory|Article|Name|Quantity
}{
	{"К5", "Article"}, {"К6", "Quantity"}, {"N0", "Quantity"}, {"К4", "Name"},
	{"К2", "Plate"}, {"К3", "Territory"}, {"К1", "Urgency"}, {"V5", "ClientNumber"},
	{"V4", "ClientNumber"},
}

var headerCode = regexp.MustCompile(`^[А-Яа-яA-Za-z][0-9]`)

func headerField(h string) string {
	h = strings.ToUpper(strings.TrimSpace(h))
	code := headerCode.FindString(h)
	if code == "" {
		return ""
	}
	for _, c := range headerCols {
		if c.prefix == code {
			return c.field
		}
	}
	return ""
}

// ParseImportSheet — разбор содержимого файла (.xlsx/.xlsm/.csv) в строки листа.
// TODO(ФТ v2, п. 4 «Вставка заявки»): серверный разбор файла есть, но в PWA нет построчной вставки из буфера
// (Ctrl+V) и нет поля «База» — нужны UI и реквизит (см. LinesView.vue, лист заказа).
func ParseImportSheet(name string, data []byte) (*ImportRows, error) {
	var grid [][]string
	var err error
	switch {
	case strings.HasSuffix(strings.ToLower(name), ".csv"):
		grid, err = parseCSV(data)
	default:
		grid, err = parseXLSX(data)
	}
	if err != nil {
		return nil, err
	}
	if len(grid) < 2 {
		return nil, fail(400, "bad_request", "В файле нет строк данных")
	}

	// Заголовок — первая строка, где опознано >= 2 нужных колонок (выше могут быть баннеры шаблона).
	hdrIdx, cols := -1, map[int]string{}
	for i, row := range grid {
		m := map[int]string{}
		for j, cell := range row {
			if f := headerField(cell); f != "" {
				if _, dup := m[j]; !dup {
					m[j] = f
				}
			}
		}
		if len(m) >= 2 {
			hdrIdx, cols = i, m
			break
		}
	}
	if hdrIdx < 0 {
		return nil, fail(400, "bad_request", "Не найдена строка заголовков (К4Наименование, К5Артикул, К6Кол-во…)")
	}

	out := &ImportRows{}
	seen := map[string]bool{} // сжатие пустых
	for _, row := range grid[hdrIdx+1:] {
		r := arm.ImportRow{}
		for j, f := range cols {
			if j >= len(row) {
				continue
			}
			v := strings.TrimSpace(row[j])
			if v == "" {
				continue
			}
			switch f {
			case "Article":
				r.Article = v
			case "Name":
				r.Name = v
			case "Quantity":
				r.Quantity = normQty(v)
			case "Plate":
				r.Plate = v
			case "Territory":
				r.Territory = v
			case "Urgency":
				r.Urgency = v
			case "ClientNumber":
				if r.ClientNumber == "" {
					r.ClientNumber = v
				}
			}
		}
		if r.Article == "" && r.Name == "" {
			continue
		}
		key := r.ClientNumber + "|" + r.Article + "|" + r.Name + "|" + r.Quantity
		if seen[key] {
			out.Warnings = append(out.Warnings, fmt.Sprintf("дубль пропущен: %s %s", r.Article, r.Name))
			continue
		}
		seen[key] = true
		if r.Quantity == "" {
			r.Quantity = "1"
			out.Warnings = append(out.Warnings, fmt.Sprintf("%s: количество не указано, принято 1", firstNonEmpty(r.Article, r.Name)))
		}
		out.Rows = append(out.Rows, r)
	}
	if len(out.Rows) == 0 {
		return nil, fail(400, "empty_sheet", "В листе нет строк с артикулом или наименованием")
	}
	return out, nil
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// normQty — «2,00»/«2,5 шт»/«10» → каноничное десятичное с точкой.
func normQty(s string) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\u00a0", ""))
	s = strings.Replace(s, ",", ".", 1)
	i := 0
	for i < len(s) && (s[i] >= '0' && s[i] <= '9' || s[i] == '.' || s[i] == '-') {
		i++
	}
	s = s[:i]
	if f, err := strconv.ParseFloat(s, 64); err == nil && f > 0 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return ""
}

func parseXLSX(data []byte) ([][]string, error) {
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, fail(400, "bad_request", "Не удалось открыть XLSX: "+err.Error())
	}
	defer f.Close()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, fail(400, "bad_request", "В книге нет листов")
	}
	// Первый неотфильтрованный лист; данные шаблона — на первом листе.
	rows, err := f.GetRows(sheets[0])
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func parseCSV(data []byte) ([][]string, error) {
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	sep := detectSep(data)
	r := csv.NewReader(bytes.NewReader(data))
	r.Comma = sep
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	var out [][]string
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fail(400, "bad_request", "CSV: "+err.Error())
		}
		out = append(out, rec)
	}
	return out, nil
}

func detectSep(data []byte) rune {
	line := string(data)
	if i := strings.IndexByte(line, '\n'); i > 0 {
		line = line[:i]
	}
	best, cnt := ';', strings.Count(line, ";")
	for _, c := range []rune{',', '\t'} {
		if n := strings.Count(line, string(c)); n > cnt {
			best, cnt = c, n
		}
	}
	return best
}
