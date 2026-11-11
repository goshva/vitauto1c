package arm

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Field — поле строки (fields_gen.go): столбец arm.line и вид значения (ref, enum, date, number, bool, text).
type Field struct {
	Column string
	Kind   string
}

//go:embed matrix.json
var matrixJSON []byte

// MatrixColumn — колонка матрицы прав роли (pwa/src/odata/matrix.json, копия — `task gen`).
type MatrixColumn struct {
	ID       string `json:"id"`
	Field    string `json:"field"`
	Code     string `json:"code"`
	Title    string `json:"title"`
	DataType string `json:"dataType"`
	Writable bool   `json:"writable"`
	Rights   string `json:"rights"` // символ на статус statuses: + можно, c только автор, . нельзя
}

type matrixFile struct {
	Source     string                    `json:"source"`
	Statuses   []string                  `json:"statuses"`
	StatusEnum map[string][]string       `json:"statusEnum"`
	Roles      map[string][]MatrixColumn `json:"roles"`
}

// Матрица хранится в памяти и может перечитываться с диска (hot-reload):
// PUT /settings/groups/{role}/matrix пишет matrix.json, изменение файла извне
// (settings-import.ps1) подхватывается по mtime при следующем чтении.
var (
	matrixMu  sync.RWMutex
	matrix    matrixFile
	matrixRev int64
)

func init() {
	if err := json.Unmarshal(matrixJSON, &matrix); err != nil {
		panic(err)
	}
	matrixRev = 1
	_ = ReloadMatrix() // рабочая копия на диске, если есть
}

// matrixFilePath — записываемая копия matrix.json: env, затем рабочая копия в
// репозитории (стенд запускается из корня), затем данные приложения.
func matrixFilePath() string {
	if p := os.Getenv("VITAUTO_MATRIX"); p != "" {
		return p
	}
	for _, p := range []string{
		filepath.Join("backend", "internal", "arm", "matrix.json"),
		filepath.Join("pwa", "src", "odata", "matrix.json"),
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	if dir := os.Getenv("VITAUTO_DATA"); dir != "" {
		return filepath.Join(dir, "settings", "matrix.json")
	}
	if la := os.Getenv("LOCALAPPDATA"); la != "" {
		return filepath.Join(la, "VITAUTO", "settings", "matrix.json")
	}
	return ""
}

var (
	matrixStatMu   sync.Mutex
	matrixStatMod  time.Time
	matrixStatNext time.Time
)

// matrixCurrent — текущая матрица и её версия; перед чтением лениво проверяет mtime файла.
func matrixCurrent() (matrixFile, int64) {
	matrixMaybeReload()
	matrixMu.RLock()
	defer matrixMu.RUnlock()
	return matrix, matrixRev
}

// matrixMaybeReload — не чаще раза в секунду сверяет mtime рабочего файла и перечитывает его.
func matrixMaybeReload() {
	p := matrixFilePath()
	if p == "" {
		return
	}
	matrixStatMu.Lock()
	now := time.Now()
	if now.Before(matrixStatNext) {
		matrixStatMu.Unlock()
		return
	}
	matrixStatNext = now.Add(time.Second)
	mod := matrixStatMod
	matrixStatMu.Unlock()

	info, err := os.Stat(p)
	if err != nil || !info.ModTime().After(mod) {
		return
	}
	if err := ReloadMatrix(); err == nil {
		matrixStatMu.Lock()
		matrixStatMod = info.ModTime()
		matrixStatMu.Unlock()
	}
}

// ReloadMatrix — перечитать матрицу с диска (hot-reload по сигналу).
func ReloadMatrix() error {
	p := matrixFilePath()
	if p == "" {
		return nil
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return err
	}
	var m matrixFile
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	if len(m.Roles) == 0 || len(m.Statuses) == 0 {
		return fmt.Errorf("matrix.json: нет ролей или статусов")
	}
	matrixMu.Lock()
	matrix = m
	matrixRev++
	matrixMu.Unlock()
	return nil
}

// SaveMatrixRole — права роли по статусам: пишет matrix.json в рабочую копию (и
// остальные копии репозитория) и сразу обновляет матрицу в памяти.
func SaveMatrixRole(role string, cols []MatrixColumn) error {
	cur, _ := matrixCurrent()
	base, ok := cur.Roles[role]
	if !ok {
		return fail(404, "not_found", "Группа не найдена: "+role)
	}
	if len(cols) != len(base) {
		return fail(400, "bad_request", fmt.Sprintf("Ожидалось колонок: %d, получено: %d", len(base), len(cols)))
	}
	clean := make([]MatrixColumn, len(cols))
	for i, c := range cols {
		if c.ID != base[i].ID {
			return fail(400, "bad_request", fmt.Sprintf("Колонка %d: ожидался id %s, получен %s", i, base[i].ID, c.ID))
		}
		if len(c.Rights) != len(cur.Statuses) {
			return fail(400, "bad_request", fmt.Sprintf("Колонка %s: маска прав должна быть длиной %d", c.ID, len(cur.Statuses)))
		}
		for _, ch := range c.Rights {
			if ch != '+' && ch != 'c' && ch != '.' {
				return fail(400, "bad_request", fmt.Sprintf("Колонка %s: недопустимый символ прав %q", c.ID, string(ch)))
			}
		}
		clean[i] = base[i]         // метаданные колонки не меняем
		clean[i].Rights = c.Rights // меняем только маску прав
	}
	next := matrixFile{
		Source:     cur.Source,
		Statuses:   append([]string(nil), cur.Statuses...),
		StatusEnum: cur.StatusEnum,
		Roles:      make(map[string][]MatrixColumn, len(cur.Roles)),
	}
	for r, c := range cur.Roles {
		if r == role {
			next.Roles[r] = clean
		} else {
			next.Roles[r] = c
		}
	}
	masks := make([]string, len(clean))
	for i := range clean {
		masks[i] = clean[i].Rights
	}
	if err := patchMatrixFiles(role, masks); err != nil {
		return fail(500, "server_error", "Не удалось записать matrix.json: "+err.Error())
	}
	matrixMu.Lock()
	matrix = next
	matrixRev++
	matrixMu.Unlock()
	return nil
}

// matrixTargets — копии матрицы, которые держим синхронно (рабочая + уже существующие в репозитории).
// Если путь задан явно через VITAUTO_MATRIX, пишем только в него.
func matrixTargets() []string {
	primary := matrixFilePath()
	if os.Getenv("VITAUTO_MATRIX") != "" {
		return []string{primary}
	}
	list := []string{primary}
	for _, p := range []string{
		filepath.Join("backend", "internal", "arm", "matrix.json"),
		filepath.Join("backend", "internal", "domain", "matrix.json"),
		filepath.Join("pwa", "src", "odata", "matrix.json"),
	} {
		if _, err := os.Stat(p); err == nil {
			list = append(list, p)
		}
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(list))
	for _, p := range list {
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

var (
	reRoleBlock = regexp.MustCompile(`(?m)^  "([a-z_]+)": \[[\r]?$`)
	reRights    = regexp.MustCompile(`("rights":\s*")([^"]*)(")`)
)

// patchMatrixRights — меняет только маски прав роли, не трогая остальной текст файла:
// сохраняются порядок ключей, отступ в 1 пробел и CRLF, поэтому git-diff — только
// изменённые строки `rights`.
func patchMatrixRights(text, role string, masks []string) (string, error) {
	locs := reRoleBlock.FindAllStringSubmatchIndex(text, -1)
	start := -1
	for _, loc := range locs {
		if text[loc[2]:loc[3]] == role {
			start = loc[1] // позиция сразу после '['
			break
		}
	}
	if start < 0 {
		return "", fmt.Errorf("роль %q не найдена в matrix.json", role)
	}
	end := -1
	depth := 1
	for j := start; j < len(text); j++ {
		switch text[j] {
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				end = j
			}
		}
		if end >= 0 {
			break
		}
	}
	if end < 0 {
		return "", fmt.Errorf("не найден конец блока роли %q", role)
	}
	block := text[start:end]
	idx := 0
	patched := reRights.ReplaceAllStringFunc(block, func(m string) string {
		if idx >= len(masks) {
			return m
		}
		sub := reRights.FindStringSubmatch(m)
		out := sub[1] + masks[idx] + sub[3]
		idx++
		return out
	})
	if idx != len(masks) {
		return "", fmt.Errorf("в блоке роли %q найдено %d масок, ожидалось %d", role, idx, len(masks))
	}
	return text[:start] + patched + text[end:], nil
}

func writeFileAtomic(p string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// ensureMatrixFile — создаёт рабочую копию matrix.json из встроенной, если файла ещё нет
// (сборка вне репозитория: %LOCALAPPDATA%\VITAUTO\settings).
func ensureMatrixFile() error {
	p := matrixFilePath()
	if p == "" {
		return fmt.Errorf("не задан путь matrix.json (VITAUTO_MATRIX / VITAUTO_DATA / LOCALAPPDATA)")
	}
	if _, err := os.Stat(p); err == nil {
		return nil
	}
	return writeFileAtomic(p, matrixJSON)
}

// patchMatrixFiles — применить маски роли во всех копиях matrix.json.
func patchMatrixFiles(role string, masks []string) error {
	if err := ensureMatrixFile(); err != nil {
		return err
	}
	var firstErr error
	wrote := false
	for _, p := range matrixTargets() {
		cur, err := os.ReadFile(p)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		next, err := patchMatrixRights(string(cur), role, masks)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if err := writeFileAtomic(p, []byte(next)); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		wrote = true
	}
	if !wrote {
		if firstErr == nil {
			firstErr = fmt.Errorf("нет доступного matrix.json для записи")
		}
		return firstErr
	}
	// своя же запись не должна выглядеть как внешнее изменение
	if p := matrixFilePath(); p != "" {
		if info, err := os.Stat(p); err == nil {
			matrixStatMu.Lock()
			matrixStatMod = info.ModTime()
			matrixStatMu.Unlock()
		}
	}
	return nil
}

// MatrixResponse — GET /matrix.
type MatrixResponse struct {
	Role     string         `json:"role"`
	Statuses []string       `json:"statuses"`
	Columns  []MatrixColumn `json:"columns"`
}

// MatrixFor — матрица роли (неизвестная роль — как менеджер, как в PWA).
func MatrixFor(role string) MatrixResponse {
	m, _ := matrixCurrent()
	cols, ok := m.Roles[role]
	if !ok {
		cols = m.Roles["manager"]
	}
	return MatrixResponse{Role: role, Statuses: m.Statuses, Columns: cols}
}

// MatrixETag — версия матрицы для If-None-Match.
func MatrixETag() string {
	m, rev := matrixCurrent()
	return fmt.Sprintf(`"%d-%d-%d-%d"`, rev, len(m.Source), len(m.Roles["manager"]), len(m.Statuses))
}

// apiStatus — код статуса API по значению 1С (Подготовлено и Собран -> ready_to_ship).
func apiStatus(onec string) string {
	if onec == stLockedBgJob {
		return "locked_background"
	}
	m, _ := matrixCurrent()
	for id, enums := range m.StatusEnum {
		for _, e := range enums {
			if e == onec {
				return id
			}
		}
	}
	return onec
}

// denyReason — почему поле нельзя менять (как useMatrixStore.denyReason PWA и ОтказИзмененияСтрокиOData 1С) или "".
func denyReason(col MatrixColumn, status string, markedByMe bool) string {
	if !col.Writable {
		return "поле только для чтения"
	}
	if status == stLockedBgJob {
		return "строка заблокирована фоном"
	}
	m, _ := matrixCurrent()
	st := apiStatus(status)
	i := -1
	for k, s := range m.Statuses {
		if s == st {
			i = k
		}
	}
	ch := byte('.')
	if i >= 0 && i < len(col.Rights) {
		ch = col.Rights[i]
	}
	switch ch {
	case '+':
		return ""
	case 'c':
		if markedByMe {
			return ""
		}
		return "меняет только автор строки"
	}
	return fmt.Sprintf("матрица: нельзя в статусе «%s»", st)
}

func columnFor(role, field string) (MatrixColumn, bool) {
	for _, c := range MatrixFor(role).Columns {
		if c.Field == field {
			return c, true
		}
	}
	return MatrixColumn{}, false
}

// Transition — переход процесса (Арм_API.ПереходыПроцессов; docs/migration/ddd/generated/fsm.md).
type Transition struct {
	To     string
	Status string // значение 1С
	From   []string
	Roles  []string
}

// Transitions — POST /lines/transition. Тест сверяет с domain-model.json (pwa/src/odata/backend.js TRANSITIONS).
var Transitions = []Transition{
	{"reserve", stReserve, []string{"new", "in_work"}, []string{"manager", "admin"}},
	{"assembly", stAssembly, []string{"reserve", "to_stock", "acceptance"}, []string{"manager", "admin"}},
	{"assembly", stAssembly, []string{"ready_to_ship"}, []string{"manager", "admin", "chief_mechanic"}},
	{"assembly", stAssembly, []string{"return"}, []string{"manager", "admin"}},
	{"ready_to_ship", stAssembled, []string{"assembly"}, []string{"storekeeper", "manager", "admin"}},
	{"shipped", stShipped, []string{"paid", "in_transit"}, []string{"manager", "admin"}},
	{"acceptance", stAcceptance, []string{"shipped"}, []string{"storekeeper", "admin"}},
	{"return", stReturn, []string{"shipped", "ordered", "paid", "in_transit", "to_stock", "closed"}, []string{"manager", "storekeeper", "admin"}},
	{"closed", stDone, []string{"shipped", "ready_to_ship", "return"}, []string{"manager", "storekeeper", "admin"}},
	{"closed", stDone, []string{"assembly"}, []string{"chief_mechanic", "admin"}},
}

// SupplyStatus — канбан снабжения: код → значение 1С и предыдущее значение цепочки (ИзменитьСтатусыВРегистреСнабжения).
var SupplyStatus = map[string][2]string{
	"paid": {stPaid, stOrdered}, "in_transit": {stInTransit, stPaid}, "acceptance": {stAcceptance, stInTransit},
	"to_stock": {stToStock, stAcceptance}, "assembly": {stAssembly, stToStock}, "assembled": {stAssembled, stAssembly},
}

// SupplyRoles — кому доступен канбан снабжения. По схеме контроль оплаты (M7) — менеджер (ddd/generated/fsm.md,
// «Расхождения»): в Go разрешён manager; в OData-бэкенде PWA — только supply и admin.
var SupplyRoles = []string{"supply", "admin", "manager", "storekeeper"}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func joinQuoted(list []string) string { return "«" + strings.Join(list, "», «") + "»" }
