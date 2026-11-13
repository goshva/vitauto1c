package postgres

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestFieldMap_Complete — каждый столбец из field_map_gen.go существует в arm.line.
//
// Реестр полей генерируется из docs/migration/storage-map.json, а схема приходит из миграций;
// рассинхронизация (поле есть в карте, столбца нет) даёт ошибку SQL только в рантайме.
// Тест ловит это до деплоя.
//
// Переименование или удаление столбца в миграции без перегенерации карты — именно тот случай,
// который здесь и проверяется. Обратное направление (в arm.line есть столбцы, которых нет
// в карте) намеренно не проверяется: часть столбцов добавляют миграции, а не 1С
// (warehouse_id, cell_id, self_pickup, zone_id, extra_flag, price_change_type).
func TestFieldMap_Complete(t *testing.T) {
	ctx := context.Background()
	dsn := os.Getenv("VITAUTO_DB")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@127.0.0.1:5434/vitauto_app"
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("база стенда недоступна (%v): задайте VITAUTO_DB или поднимите docker-compose.test.yml", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("база стенда недоступна (%v): задайте VITAUTO_DB или поднимите docker-compose.test.yml", err)
	}

	rows, err := pool.Query(ctx, `select column_name from information_schema.columns
		where table_schema = 'arm' and table_name = 'line'`)
	if err != nil {
		t.Fatalf("чтение схемы arm.line: %v", err)
	}
	defer rows.Close()
	have := map[string]bool{}
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			t.Fatalf("scan: %v", err)
		}
		have[c] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	if len(have) == 0 {
		t.Skip("в схеме нет таблицы arm.line: обновите схему (go run ./cmd/migrator schema-up)")
	}

	if len(fieldColumn) == 0 {
		t.Fatal("fieldColumn пуст: field_map_gen.go не сгенерирован")
	}
	var missing []string
	for field, col := range fieldColumn {
		if !have[col] {
			missing = append(missing, string(field)+" → "+col)
		}
	}
	if len(missing) > 0 {
		t.Errorf("в field_map_gen.go %d столбцов, которых нет в arm.line:\n%v\n"+
			"Перегенерируйте: cd backend && go run ./cmd/migrator gen", len(missing), missing)
	}
}

// TestFieldMap_ReverseComplete — обратная карта покрывает прямую без потерь.
// Не требует базы: проверяет только сгенерированный файл.
func TestFieldMap_ReverseComplete(t *testing.T) {
	if len(fieldColumn) != len(columnField) {
		t.Fatalf("fieldColumn=%d, columnField=%d: карты разной длины", len(fieldColumn), len(columnField))
	}
	for field, col := range fieldColumn {
		back, ok := columnField[col]
		if !ok {
			t.Errorf("columnField не содержит столбец %q (поле %q)", col, field)
			continue
		}
		if back != field {
			t.Errorf("columnField[%q] = %q, а fieldColumn[%q] = %q", col, back, field, col)
		}
	}
}
