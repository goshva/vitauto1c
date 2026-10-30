package migrate

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"

	"vitauto/backend/internal/onec"
)

// R8: 50 документов и 50 элементов справочников — представление в 1С (COM) совпадает с данными vitauto_app:
// у справочника — наименование, у документа — номер и дата.
func (rc *reconcileCtx) r8(ctx context.Context) checkResult {
	r := checkResult{ID: "R8", Title: "50 документов и 50 справочников: представление в 1С (COM) = наименование / номер и дата в vitauto_app"}
	type item struct {
		object, id, name, number string
		date                     *time.Time
	}
	var items []item
	pick := func(kind tableKind, limit int) error {
		var tables []onec.MapTable
		for _, t := range rc.meta.Map.Tables {
			if t.Rule == "typed" && t.Purpose == "Основная" && kindOf(t) == kindRef && strings.HasPrefix(t.Table, map[bool]string{true: "Документ.", false: "Справочник."}[kind == kindTP]) {
				tables = append(tables, t)
			}
		}
		var parts []string
		for _, t := range tables {
			p := strings.SplitN(t.Target, ".", 2)
			cols := "name, null::text, null::timestamp"
			if strings.HasPrefix(t.Table, "Документ.") {
				cols = "null::text, number, date"
			}
			parts = append(parts, fmt.Sprintf("select '%s' as object, id::text, %s from %s where not coalesce((extra->>'ЭтоГруппа')::boolean, false)",
				t.Table, cols, pgx.Identifier{p[0], p[1]}.Sanitize()))
		}
		// детерминированная «случайная» выборка: порядок по md5(id)
		rows, err := rc.db.Query(ctx, "select * from ("+strings.Join(parts, " union all ")+") s order by md5(id) limit $1", limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var it item
			var name, number *string
			if err := rows.Scan(&it.object, &it.id, &name, &number, &it.date); err != nil {
				return err
			}
			if name != nil {
				it.name = *name
			}
			if number != nil {
				it.number = *number
			}
			items = append(items, it)
		}
		return rows.Err()
	}
	if err := pick(kindTP, 50); err != nil { // kindTP здесь — признак «документы»
		r.Diffs++
		r.Details = append(r.Details, err.Error())
		return r
	}
	if err := pick(kindRef, 50); err != nil {
		r.Diffs++
		r.Details = append(r.Details, err.Error())
		return r
	}
	var in strings.Builder
	for _, it := range items {
		fmt.Fprintf(&in, "%s\t%s\r\n", it.object, it.id)
	}
	pres, err := rc.m.comPresentations(in.String())
	if err != nil {
		r.Diffs++
		r.Details = append(r.Details, err.Error())
		return r
	}
	for _, it := range items {
		p, ok := pres[it.id]
		bad := !ok || strings.HasPrefix(p, "!")
		if !bad && it.number != "" {
			// 1С печатает номер без префикса и ведущих нулей: НФНФ-000200 -> «Заказ покупателя 200 от 29.10.2026»
			digits := strings.TrimLeft(reDigits.FindString(strings.TrimSpace(it.number)), "0")
			bad = !regexp.MustCompile(`\b`+regexp.QuoteMeta(digits)+`\b`).MatchString(p) ||
				(it.date != nil && !strings.Contains(p, it.date.Format("02.01.2006")))
		} else if !bad {
			// представление справочника начинается с наименования (автомобиль дописывает госномер)
			bad = !strings.HasPrefix(strings.TrimSpace(p), strings.TrimSpace(it.name))
		}
		if bad {
			r.Diffs++
			r.Details = append(r.Details, fmt.Sprintf("%s %s: 1С «%s», vitauto_app «%s%s»", it.object, it.id, p, it.name, it.number))
		}
	}
	r.Details = append(r.Details, fmt.Sprintf("проверено %d", len(items)))
	return r
}

// comPresentations запускает tools/migration/onec-presentations.js (32-битный cscript, файлы UTF-16).
func (m *Migrator) comPresentations(input string) (map[string]string, error) {
	dir, err := os.MkdirTemp("", "vitauto-r8-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	script, err := os.ReadFile(filepath.Join(m.Root, "tools", "migration", "onec-presentations.js"))
	if err != nil {
		return nil, err
	}
	js, in, out := filepath.Join(dir, "p.js"), filepath.Join(dir, "in.txt"), filepath.Join(dir, "out.txt")
	if err := os.WriteFile(js, utf16le(string(script)), 0o644); err != nil {
		return nil, err
	}
	if err := os.WriteFile(in, utf16le(input), 0o644); err != nil {
		return nil, err
	}
	cmd := exec.Command(`C:\Windows\SysWOW64\cscript.exe`, "//nologo", "//E:JScript", js, in, out, m.SourceBase)
	if b, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("cscript: %v %s", err, b)
	}
	raw, err := os.ReadFile(out)
	if err != nil {
		return nil, err
	}
	res := map[string]string{}
	for _, line := range strings.Split(fromUTF16(raw), "\n") {
		p := strings.SplitN(strings.TrimRight(line, "\r"), "\t", 2)
		if len(p) == 2 {
			if p[0] == "ERROR" {
				return nil, fmt.Errorf("COM: %s", p[1])
			}
			res[p[0]] = p[1]
		}
	}
	return res, nil
}

func utf16le(s string) []byte {
	u := utf16.Encode([]rune(s))
	b := []byte{0xFF, 0xFE}
	for _, x := range u {
		b = append(b, byte(x), byte(x>>8))
	}
	return b
}

func fromUTF16(b []byte) string {
	if len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE {
		b = b[2:]
	}
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = uint16(b[2*i]) | uint16(b[2*i+1])<<8
	}
	return string(utf16.Decode(u))
}

var reDigits = regexp.MustCompile(`[0-9]+$`)
