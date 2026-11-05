package migrate

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5"

	"vitauto/backend/internal/onec"
)

// Сгенерированные db/migrations/0002_typed.sql и db/load/typed.sql актуальны (нужна копия 1С; без неё тест пропускается).
func TestGeneratedSQLFresh(t *testing.T) {
	dsn := os.Getenv("VITAUTO_SRC_DSN")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5433/vitauto_dev"
	}
	ctx := context.Background()
	src, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("копия 1С недоступна: %v", err)
	}
	defer src.Close(ctx)
	root := filepath.Join("..", "..", "..")
	meta, err := onec.LoadMeta(root, "vitauto_dev")
	if err != nil {
		t.Fatal(err)
	}
	var storages []string
	for _, tb := range meta.Map.Tables {
		if tb.Rule == "typed" {
			storages = append(storages, tb.Storage)
		}
	}
	cols, err := SourceColumns(ctx, src, storages)
	if err != nil {
		t.Fatal(err)
	}
	ddl, load, err := Generate(meta, cols)
	if err != nil {
		t.Fatal(err)
	}
	for file, want := range map[string]string{"db/migrations/0002_typed.sql": ddl, "db/load/typed.sql": load} {
		got, err := os.ReadFile(filepath.Join(root, file))
		if err != nil || normalize(string(got)) != normalize(want) {
			t.Errorf("%s устарел: vitauto-migrator gen", file)
		}
	}
}

func normalize(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] != '\r' {
			out = append(out, s[i])
		}
	}
	return string(out)
}
