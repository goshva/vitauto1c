package arm

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Настройки прав групп: роль = группа; матрица, процессы/узлы и CRUD связаны между собой.
func TestUserGroups(t *testing.T) {
	s := &Service{}
	resp, err := s.UserGroups(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	m, _ := matrixCurrent()
	if len(resp.Groups) != len(m.Roles) {
		t.Fatalf("групп %d, ролей в матрице %d", len(resp.Groups), len(m.Roles))
	}
	if resp.Source == "" || len(resp.Statuses) == 0 || len(resp.Columns) == 0 {
		t.Fatalf("неполный ответ: source=%q, статусов %d, колонок %d", resp.Source, len(resp.Statuses), len(resp.Columns))
	}
	for _, g := range resp.Groups {
		if g.Role == "" || g.Title == "" {
			t.Fatalf("группа без роли/заголовка: %+v", g)
		}
		if len(g.Matrix) == 0 {
			t.Fatalf("%s: пустая матрица", g.Role)
		}
	}
}

// Одна группа: матрица, её процессы и узлы, CRUD.
func TestUserGroupByRole(t *testing.T) {
	s := &Service{}
	g, err := s.UserGroupByRole(context.Background(), "admin")
	if err != nil {
		t.Fatal(err)
	}
	if g.Role != "admin" || g.Title != "Администратор" {
		t.Fatalf("группа: %+v", g)
	}
	if len(g.Matrix) == 0 || len(g.Processes) == 0 || len(g.CRUD) == 0 {
		t.Fatalf("admin: матрица %d, узлы %d, CRUD %d", len(g.Matrix), len(g.Processes), len(g.CRUD))
	}
	if _, err := s.UserGroupByRole(context.Background(), "unknown"); AsProblem(err).Status != 404 {
		t.Fatalf("неизвестная роль: ожидался 404, получено %v", err)
	}
}

func TestUserGroupMatrix(t *testing.T) {
	s := &Service{}
	m, err := s.UserGroupMatrix(context.Background(), "manager")
	if err != nil {
		t.Fatal(err)
	}
	mx, _ := matrixCurrent()
	if m.Role != "manager" || len(m.Columns) != len(mx.Roles["manager"]) {
		t.Fatalf("матрица менеджера: role=%q, колонок %d", m.Role, len(m.Columns))
	}
}

// Запись матрицы: валидация маски, сохранение в память, откат к исходной маске.
// Пишем во временный файл (VITAUTO_MATRIX), чтобы не трогать рабочий matrix.json.
func TestSaveMatrixRole(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "matrix.json")
	t.Setenv("VITAUTO_MATRIX", path)

	orig, err := os.ReadFile("matrix.json")
	if err != nil {
		t.Skipf("нет matrix.json: %v", err)
	}
	if err := os.WriteFile(path, orig, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ReloadMatrix(); err != nil {
		t.Fatalf("ReloadMatrix: %v", err)
	}

	before, _ := matrixCurrent()
	base := append([]MatrixColumn(nil), before.Roles["manager"]...)
	cols := append([]MatrixColumn(nil), base...)
	cols[0].Rights = strings.Repeat("+", len(before.Statuses))

	if err := SaveMatrixRole("manager", cols); err != nil {
		t.Fatalf("SaveMatrixRole: %v", err)
	}
	after, _ := matrixCurrent()
	if after.Roles["manager"][0].Rights != cols[0].Rights {
		t.Fatalf("маска не применилась: %q", after.Roles["manager"][0].Rights)
	}
	// файл: та же длина, изменилась только маска (патч, а не перезапись целиком)
	patched, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(patched) != len(orig) {
		t.Fatalf("длина файла изменилась: %d -> %d", len(orig), len(patched))
	}
	// файл на диске перечитывается
	if err := ReloadMatrix(); err != nil {
		t.Fatalf("ReloadMatrix: %v", err)
	}
	reloaded, _ := matrixCurrent()
	if reloaded.Roles["manager"][0].Rights != cols[0].Rights {
		t.Fatalf("файл не сохранился: %q", reloaded.Roles["manager"][0].Rights)
	}
	// неверная длина маски — ошибка, матрица не меняется
	bad := append([]MatrixColumn(nil), base...)
	bad[0].Rights = "++"
	if err := SaveMatrixRole("manager", bad); AsProblem(err).Status != 400 {
		t.Fatalf("ожидался 400 на короткую маску, получено %v", err)
	}
	if err := SaveMatrixRole("nope", base); AsProblem(err).Status != 404 {
		t.Fatalf("ожидался 404 на неизвестную роль, получено %v", err)
	}
	// вернуть исходную маску
	if err := SaveMatrixRole("manager", base); err != nil {
		t.Fatalf("rollback: %v", err)
	}
}

func TestUserGroupProcesses(t *testing.T) {
	s := &Service{}
	nodes, err := s.UserGroupProcesses(context.Background(), "manager")
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) == 0 {
		t.Fatal("у менеджера нет узлов")
	}
	for _, n := range nodes {
		if n.Role != "manager" {
			t.Fatalf("узел %s: роль %q", n.ID, n.Role)
		}
		if len(n.Columns) == 0 {
			t.Fatalf("узел %s: нет колонок", n.ID)
		}
	}
}

// Связь прав и CRUD с процессами и узлами: каждая колонка узла есть в матрице группы,
// CRUD группы — только разрешённые сущности; у админа — все справочники.
func TestUserGroupsLink(t *testing.T) {
	s := &Service{}
	resp, err := s.UserGroups(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	byRole := map[string]UserGroup{}
	for _, g := range resp.Groups {
		byRole[g.Role] = g
	}
	for _, g := range resp.Groups {
		ids := map[string]bool{}
		for _, c := range g.Matrix {
			ids[c.ID] = true
		}
		for _, n := range g.Processes {
			for _, col := range n.Columns {
				if !ids[col] {
					t.Fatalf("%s: колонка узла %s (%s) отсутствует в матрице группы", g.Role, col, n.ID)
				}
			}
		}
	}
	admin := byRole["admin"]
	if len(admin.CRUD) != len(dirNames())+len(CatalogEdit)+1 {
		t.Fatalf("admin: CRUD %d, ожидалось справочники %d + каталог %d + бренды 1",
			len(admin.CRUD), len(dirNames()), len(CatalogEdit))
	}
	manager := byRole["manager"]
	for _, c := range manager.CRUD {
		if c.Entity == "directories" {
			t.Fatalf("manager не должен иметь CRUD справочников: %+v", c)
		}
	}
}
