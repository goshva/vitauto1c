package arm

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
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

var matrix = func() matrixFile {
	var m matrixFile
	if err := json.Unmarshal(matrixJSON, &m); err != nil {
		panic(err)
	}
	return m
}()

// MatrixResponse — GET /matrix.
type MatrixResponse struct {
	Role     string         `json:"role"`
	Statuses []string       `json:"statuses"`
	Columns  []MatrixColumn `json:"columns"`
}

// MatrixFor — матрица роли (неизвестная роль — как менеджер, как в PWA).
func MatrixFor(role string) MatrixResponse {
	cols, ok := matrix.Roles[role]
	if !ok {
		cols = matrix.Roles["manager"]
	}
	return MatrixResponse{Role: role, Statuses: matrix.Statuses, Columns: cols}
}

// MatrixETag — версия матрицы для If-None-Match.
func MatrixETag() string {
	return fmt.Sprintf(`"%d-%d-%d"`, len(matrix.Source), len(matrix.Roles["manager"]), len(matrix.Statuses))
}

// apiStatus — код статуса API по значению 1С (Подготовлено и Собран -> ready_to_ship).
func apiStatus(onec string) string {
	if onec == stLockedBgJob {
		return "locked_background"
	}
	for id, enums := range matrix.StatusEnum {
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
	st := apiStatus(status)
	i := -1
	for k, s := range matrix.Statuses {
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
