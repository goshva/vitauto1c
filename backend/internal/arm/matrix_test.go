package arm

import (
	"encoding/json"
	"os"
	"testing"
)

// Патч масок не должен менять файл, если маски те же: сохраняются порядок ключей,
// отступ 1 пробел и CRLF (иначе правка одной маски давала бы diff в 3676 строк).
func TestMatrixPatchNoop(t *testing.T) {
	b, err := os.ReadFile("matrix.json")
	if err != nil {
		t.Skipf("нет matrix.json рядом с пакетом: %v", err)
	}
	var m matrixFile
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for role, cols := range m.Roles {
		masks := make([]string, len(cols))
		for i, c := range cols {
			masks[i] = c.Rights
		}
		out, err := patchMatrixRights(string(b), role, masks)
		if err != nil {
			t.Fatalf("%s: %v", role, err)
		}
		if out != string(b) {
			t.Fatalf("%s: патч без изменений поменял файл", role)
		}
	}
}
