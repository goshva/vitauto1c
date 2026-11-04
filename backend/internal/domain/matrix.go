package domain

import (
	_ "embed"
	"encoding/json"
	"fmt"
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

// DenyReason — почему поле нельзя менять (как useMatrixStore.denyReason PWA и ОтказИзмененияСтрокиOData 1С) или "".
// markedByMe — строку пометил текущий пользователь (символ 'c' в матрице).
func DenyReason(role string, col MatrixColumn, status Status, markedByMe bool) string {
	if !col.Writable {
		return "поле только для чтения"
	}
	if status == StatusLockedBgJob {
		return "строка заблокирована фоном"
	}
	st := status.APICode()
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

// ColumnFor — колонка матрицы роли по имени поля API.
func ColumnFor(role, field string) (MatrixColumn, bool) {
	for _, c := range MatrixFor(role).Columns {
		if c.Field == field {
			return c, true
		}
	}
	return MatrixColumn{}, false
}
