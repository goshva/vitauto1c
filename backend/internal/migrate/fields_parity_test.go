package migrate

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

// repoRoot — корень репозитория по расположению этого файла (internal/migrate → ../../..).
func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller недоступен")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}

func readRepoFile(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(repoRoot(t), filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("чтение %s: %v", rel, err)
	}
	return strings.ReplaceAll(string(b), "\r\n", "\n")
}

// Два подводных камня, проверенных на практике при написании этого теста:
//  1. в RE2 с флагом (?m) `$` совпадает ПЕРЕД переводом строки, поэтому шаблон должен
//     заканчиваться на `,$`, а не на `,\n$` — иначе он не совпадёт ни с одной строкой
//     и тест станет пустышкой;
//  2. генератор пишет `"Поле": {…}` с одним пробелом, но мигратор прогоняет результат
//     через go/format, поэтому в файле лежит ВЫРОВНЕННЫЙ текст с переменным числом пробелов:
//     шаблон обязан допускать `\s+`, иначе совпадут только строки с самым длинным ключом.
var (
	reFieldEntry = regexp.MustCompile(`(?m)^\t"([^"]+)":\s+\{Column: "([^"]+)", Kind: "([^"]+)"\},$`)
	reSpaces     = regexp.MustCompile(`:\s+`)
)

// TestFieldsGenParity — сгенерированные артефакты не разошлись.
//
// Пока arm сохраняет свою копию карты полей (до Step 2c), обе копии делает один генератор.
// Поэтому domain/fields_gen.go обязан совпадать с arm/fields_gen.go ровно с точностью
// до двух подстановок: имя пакета и тип карты. Любое другое расхождение означает, что
// генератор обновили в одном месте и забыли в другом — или что файл правили руками.
//
// Генератор (migrate gen) требует выгрузки метаданных 1С, которой в CI нет
// (docs/migration/source/meta-vitauto_dev.jsonl), поэтому проверяется результат,
// а не повторный прогон.
func TestFieldsGenParity(t *testing.T) {
	arm := readRepoFile(t, "backend/internal/arm/fields_gen.go")
	dom := readRepoFile(t, "backend/internal/domain/fields_gen.go")

	// 1. Заголовок и объявление пакета — ровно то, что пишет генератор.
	//    Проверяются оба файла: arm/fields_gen.go генератор продолжает писать на переходный
	//    период (до Step 2c), поэтому он обязан воспроизводиться, а не «застывать».
	if want := generatedHeader + "package domain\n\n"; !strings.HasPrefix(dom, want) {
		t.Errorf("domain/fields_gen.go: заголовок не совпадает с generatedHeader генератора.\n got: %q\nwant prefix: %q",
			firstLines(dom, 5), want)
	}
	if want := generatedHeader + "package arm\n\n"; !strings.HasPrefix(arm, want) {
		t.Errorf("arm/fields_gen.go: заголовок не совпадает с generatedHeader генератора.\n got: %q\nwant prefix: %q",
			firstLines(arm, 5), want)
	}

	// 2. Совпадение с копией arm с точностью до двух подстановок.
	armAsDomain := strings.Replace(arm, "package arm", "package domain", 1)
	armAsDomain = strings.Replace(armAsDomain, "map[string]Field{", "map[Field]FieldInfo{", 1)
	if armAsDomain != dom {
		t.Errorf("domain/fields_gen.go разошёлся с arm/fields_gen.go.\n" +
			"Ожидалось: arm-файл с двумя подстановками (package arm→domain, map[string]Field→map[Field]FieldInfo).\n" +
			"Перегенерируйте оба файла одной командой: cd backend && go run ./cmd/migrator gen")
	}

	// 3. Формат строки записи: после снятия выравнивания строка обязана совпасть
	// с fmt-шаблоном генератора (см. GenerateDomainFields).
	entries := reFieldEntry.FindAllStringSubmatch(dom, -1)
	if len(entries) != 67 {
		t.Fatalf("domain/fields_gen.go: разобрано %d записей, ожидалось 67", len(entries))
	}
	for _, e := range entries {
		got := reSpaces.ReplaceAllString(e[0], ": ")
		want := fmt.Sprintf("\t%q: {Column: %q, Kind: %q},", e[1], e[2], e[3])
		if got != want {
			t.Errorf("формат записи разошёлся с генератором:\n got: %q\nwant: %q", got, want)
		}
	}
}

// TestFieldMapGenParity — adapters/postgres/field_map_gen.go соответствует реестру полей:
// те же 67 пар, обе карты взаимно обратны, столбцы уникальны.
func TestFieldMapGenParity(t *testing.T) {
	dom := readRepoFile(t, "backend/internal/domain/fields_gen.go")
	pg := readRepoFile(t, "backend/internal/adapters/postgres/field_map_gen.go")

	if !strings.HasPrefix(pg, generatedHeader+"package postgres\n\n") {
		t.Errorf("field_map_gen.go: заголовок не совпадает с generatedHeader генератора")
	}

	rePair := regexp.MustCompile(`(?m)^\t"([^"]+)":\s+"([^"]+)",$`)
	entries := reFieldEntry.FindAllStringSubmatch(dom, -1)
	if len(entries) == 0 {
		t.Fatal("реестр полей не разобран: шаблон не совпал ни с одной строкой " +
			"(проверять формат записи, а не пустой результат)")
	}
	want := map[string]string{} // поле → столбец
	for _, e := range entries {
		want[e[1]] = e[2]
	}

	// Разделяем файл на две карты по их объявлениям.
	iDirect := strings.Index(pg, "var fieldColumn = map[domain.Field]string{")
	iReverse := strings.Index(pg, "var columnField = map[string]domain.Field{")
	if iDirect < 0 || iReverse < 0 || iReverse < iDirect {
		t.Fatal("field_map_gen.go: не найдены обе карты (fieldColumn, columnField)")
	}
	direct := rePair.FindAllStringSubmatch(pg[iDirect:iReverse], -1)
	reverse := rePair.FindAllStringSubmatch(pg[iReverse:], -1)
	// Сторож от пустышки: без него несовпавший шаблон делает тест зелёным и бесполезным.
	if len(direct) == 0 || len(reverse) == 0 {
		t.Fatalf("карты не разобраны: fieldColumn=%d, columnField=%d записей — шаблон не совпал",
			len(direct), len(reverse))
	}

	if len(direct) != len(want) {
		t.Errorf("fieldColumn: %d записей, ожидалось %d", len(direct), len(want))
	}
	seen := map[string]bool{}
	for _, p := range direct {
		col, ok := want[p[1]]
		if !ok {
			t.Errorf("fieldColumn содержит поле %q, которого нет в Fields", p[1])
			continue
		}
		if col != p[2] {
			t.Errorf("fieldColumn[%q] = %q, в Fields %q", p[1], p[2], col)
		}
		if seen[p[2]] {
			t.Errorf("столбец %q встречается дважды — обратная карта неоднозначна", p[2])
		}
		seen[p[2]] = true
	}

	if len(reverse) != len(direct) {
		t.Fatalf("columnField: %d записей против %d в fieldColumn", len(reverse), len(direct))
	}
	// Обе карты взаимно обратны.
	fwd := map[string]string{}
	for _, p := range direct {
		fwd[p[1]] = p[2]
	}
	for _, p := range reverse {
		if fwd[p[2]] != p[1] {
			t.Errorf("обратная карта не согласована: columnField[%q] = %q, а fieldColumn[%q] = %q",
				p[1], p[2], p[2], fwd[p[2]])
		}
	}
}

// TestGeneratedArtifactsExist — оба файла на месте; если один появился без другого,
// это признак незавершённой генерации.
func TestGeneratedArtifactsExist(t *testing.T) {
	root := repoRoot(t)
	paths := []string{
		"backend/internal/domain/fields_gen.go",
		"backend/internal/adapters/postgres/field_map_gen.go",
	}
	var missing []string
	for _, p := range paths {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(p))); err != nil {
			missing = append(missing, p)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		t.Errorf("отсутствуют сгенерированные файлы: %v", missing)
	}
}

func firstLines(s string, n int) string {
	parts := strings.SplitN(s, "\n", n+1)
	if len(parts) > n {
		parts = parts[:n]
	}
	return strings.Join(parts, "\n")
}
