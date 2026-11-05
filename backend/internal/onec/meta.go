package onec

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// StorageMap — docs/migration/storage-map.json (tools/migration/storage-map.mjs): правила переноса typed-таблиц.
type StorageMap struct {
	UUIDSample *struct{ Object, Code, UUID string } `json:"uuidSample"`
	Tables     []MapTable                           `json:"tables"`
}

type MapTable struct {
	Table   string     `json:"table"`
	Storage string     `json:"storage"`
	Purpose string     `json:"purpose"`
	Rows    *int64     `json:"rows"`
	Rule    string     `json:"rule"`
	Target  string     `json:"target"`
	Order   *int       `json:"order"`
	Note    string     `json:"note"`
	Fields  []MapField `json:"fields"`
}

type MapField struct {
	Onec      string   `json:"onec"`
	Storage   []string `json:"storage"`
	Column    *string  `json:"column"`
	Composite bool     `json:"composite"`
}

// Inventory — docs/migration/inventory.json (tools/migration/inventory.mjs).
type Inventory struct {
	Totals struct {
		Objects, NonEmpty, PgTables, PgNonEmpty, DataRows int64
	} `json:"totals"`
	Objects []InvObject `json:"objects"`
}

type InvObject struct {
	Object string     `json:"object"`
	Kind   string     `json:"kind"`
	Rows   int64      `json:"rows"`
	Rule   string     `json:"rule"`
	Target *string    `json:"target"`
	Tables []InvTable `json:"tables"`
}

type InvTable struct {
	Table   string `json:"table"`
	Storage string `json:"storage"`
	Purpose string `json:"purpose"`
	Rows    int64  `json:"rows"`
}

// MetaTable — таблица хранения из docs/migration/source/meta-*.jsonl (tools/migration/onec-meta-full.js).
type MetaTable struct {
	Meta    string      `json:"meta"`
	Table   string      `json:"table"`
	Storage string      `json:"storage"`
	Purpose string      `json:"purpose"`
	Fields  [][2]string `json:"fields"` // [имя поля хранения, имя поля 1С]
}

// Meta — всё, что нужно мигратору о базе 1С.
type Meta struct {
	Map       StorageMap
	Inventory Inventory
	Tables    map[string]*MetaTable          // по storage в нижнем регистре
	Enums     map[string][]string            // Перечисление.X -> имена значений по порядку
	Types     map[string]map[string][]string // объект -> реквизит (ТЧ.Реквизит) -> типы
	TypeNo    map[int]*MetaTable             // номер типа ссылки -> основная таблица объекта
}

// LoadMeta читает документы миграции из корня репозитория; base — имя базы снимка (vitauto_dev).
func LoadMeta(root, base string) (*Meta, error) {
	m := &Meta{Tables: map[string]*MetaTable{}, Enums: map[string][]string{}, Types: map[string]map[string][]string{}, TypeNo: map[int]*MetaTable{}}
	if err := readJSON(filepath.Join(root, "docs", "migration", "storage-map.json"), &m.Map); err != nil {
		return nil, err
	}
	if err := readJSON(filepath.Join(root, "docs", "migration", "inventory.json"), &m.Inventory); err != nil {
		return nil, err
	}
	f, err := os.Open(filepath.Join(root, "docs", "migration", "source", "meta-"+base+".jsonl"))
	if err != nil {
		return nil, fmt.Errorf("метаданные 1С (tools/migration/onec-meta-full.js): %w", err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for sc.Scan() {
		line := strings.TrimPrefix(sc.Text(), string(rune(0xFEFF))) // файл cscript — UTF-16 с BOM, перекодирован в UTF-8
		if line == "" {
			continue
		}
		var probe map[string]json.RawMessage
		if err := json.Unmarshal([]byte(line), &probe); err != nil {
			return nil, fmt.Errorf("meta jsonl: %w", err)
		}
		switch {
		case probe["error"] != nil:
			return nil, fmt.Errorf("meta jsonl содержит ошибку выгрузки: %s", probe["error"])
		case probe["enum"] != nil:
			var e struct {
				Enum   string   `json:"enum"`
				Values []string `json:"values"`
			}
			_ = json.Unmarshal([]byte(line), &e)
			m.Enums[e.Enum] = e.Values
		case probe["types"] != nil:
			var t struct {
				Types string              `json:"types"`
				Attrs map[string][]string `json:"attrs"`
			}
			_ = json.Unmarshal([]byte(line), &t)
			m.Types[t.Types] = t.Attrs
		case probe["meta"] != nil:
			var t MetaTable
			_ = json.Unmarshal([]byte(line), &t)
			key := strings.ToLower(t.Storage)
			m.Tables[key] = &t
			if n, ok := TypeNumber(t.Storage); ok && t.Purpose == "Основная" {
				m.TypeNo[n] = &t
			}
		}
	}
	return m, sc.Err()
}

var reTypeNo = regexp.MustCompile(`^_(?:Reference|Document|Enum|Chrc|Acc|CKinds|Node|BPr|Task)(\d+)(?:X\d+)?$`)

// TypeNumber — номер типа ссылки из имени основной таблицы: _Reference368X1 -> 368.
func TypeNumber(storage string) (int, bool) {
	mm := reTypeNo.FindStringSubmatch(storage)
	if mm == nil {
		return 0, false
	}
	n, err := strconv.Atoi(mm[1])
	return n, err == nil
}

// ObjectOf — полное имя объекта по имени таблицы метаданных: Документ.ЗаказПокупателя.ТабличнаяЧасть.Запасы -> Документ.ЗаказПокупателя.
func ObjectOf(meta string) string {
	p := strings.Split(meta, ".")
	if len(p) < 2 {
		return meta
	}
	return p[0] + "." + p[1]
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}
