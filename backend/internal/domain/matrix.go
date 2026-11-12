package domain

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

// Field (имя поля, ubiquitous language) и FieldInfo (столбец + вид значения)
// объявлены в field.go; значения Fields заполняются генератором в fields_gen.go.

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
func MatrixFor(role Role) MatrixResponse {
	cols, ok := matrix.Roles[string(role)]
	if !ok {
		cols = matrix.Roles[string(RoleManager)]
	}
	return MatrixResponse{Role: string(role), Statuses: matrix.Statuses, Columns: cols}
}

// MatrixETag — версия матрицы для If-None-Match.
func MatrixETag() string {
	return fmt.Sprintf(`"%d-%d-%d"`, len(matrix.Source), len(matrix.Roles["manager"]), len(matrix.Statuses))
}

// DenyReason — почему поле нельзя менять (как useMatrixStore.denyReason PWA и ОтказИзмененияСтрокиOData 1С) или "".
// markedByMe — строку пометил текущий пользователь (символ 'c' в матрице).
//
// Принимает доменный Status, а не код API и не строку: ключ матрицы (StatusCode) наружу
// не выходит, поэтому передать значение 1С или код по ошибке нельзя (decision R9).
func DenyReason(role Role, col MatrixColumn, status Status, markedByMe bool) string {
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

// ColumnFor — колонка матрицы роли по имени поля (Field, ubiquitous language).
func ColumnFor(role Role, field Field) (MatrixColumn, bool) {
	for _, c := range MatrixFor(role).Columns {
		if c.Field == string(field) {
			return c, true
		}
	}
	return MatrixColumn{}, false
}
