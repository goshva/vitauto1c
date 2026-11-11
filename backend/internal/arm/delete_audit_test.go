package arm

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ТЗ п.15: удаление заказа — только администратор (проверка роли до обращения к БД).
func TestDeleteOrderRole(t *testing.T) {
	s := &Service{}
	id := "c2000000-0000-0000-0000-000000000001"
	for _, role := range []string{"manager", "storekeeper", "supply", "chief_mechanic", "client", "supplier"} {
		if err := s.DeleteOrder(context.Background(), Actor{Role: role}, id); AsProblem(err).Status != 403 {
			t.Fatalf("роль %s: DeleteOrder ожидался 403, получено %v", role, err)
		}
	}
}

// ТЗ п.12: варианты поставки доступны менеджеру, снабжению и администратору — проверка до БД.
func TestSupplyOptionRoles(t *testing.T) {
	s := &Service{}
	id := "c2000000-0000-0000-0000-000000000001"
	for _, role := range []string{"storekeeper", "chief_mechanic", "client", "supplier"} {
		if _, err := s.SupplyOptions(context.Background(), Actor{Role: role}, id); AsProblem(err).Status != 403 {
			t.Fatalf("роль %s: SupplyOptions ожидался 403, получено %v", role, err)
		}
		if _, err := s.ApplySupplyOption(context.Background(), Actor{Role: role}, id, id); AsProblem(err).Status != 403 {
			t.Fatalf("роль %s: ApplySupplyOption ожидался 403, получено %v", role, err)
		}
		if _, err := s.SupplyOptionSave(context.Background(), Actor{Role: role}, id, SupplyOptionInput{}); AsProblem(err).Status != 403 {
			t.Fatalf("роль %s: SupplyOptionSave ожидался 403, получено %v", role, err)
		}
	}
}

// ТЗ п.11: частичный резерв — только sales и роли менеджер/администратор (проверка до БД).
func TestReserveAvailableGuards(t *testing.T) {
	s := &Service{}
	ctx := context.Background()
	if _, err := s.ReserveAvailable(ctx, Actor{Role: "manager"}, "purchases", ""); AsProblem(err).Status != 400 {
		t.Fatalf("view=purchases: ожидался 400, получено %v", err)
	}
	for _, role := range []string{"storekeeper", "supply", "chief_mechanic", "client", "supplier"} {
		if _, err := s.ReserveAvailable(ctx, Actor{Role: role}, "sales", ""); AsProblem(err).Status != 403 {
			t.Fatalf("роль %s: ReserveAvailable ожидался 403, получено %v", role, err)
		}
	}
}

// Миграция 0017: у каждой таблицы с флагом deleted есть deleted_by_id и deleted_at
// (кто удалил и когда), а миграция 0018 создала справочник предложений поставщиков.
func TestDeleteAuditSchema(t *testing.T) {
	ctx := context.Background()
	dsn := os.Getenv("VITAUTO_DB")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@127.0.0.1:5434/vitauto_app"
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("база стенда недоступна (%v)", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("база стенда недоступна (%v)", err)
	}

	var version int64
	if err := pool.QueryRow(ctx, `select max(version_id) from goose_db_version where is_applied`).Scan(&version); err != nil {
		t.Skipf("нет таблицы миграций goose: %v", err)
	}
	if version < 18 {
		t.Skipf("схема на версии %d: нужна 0018 (VITAUTO_DB=<DSN> go run ./cmd/migrator schema-up)", version)
	}

	var missing int
	if err := pool.QueryRow(ctx, `
		select count(*) from information_schema.columns c
		join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
		where c.column_name = 'deleted' and t.table_type = 'BASE TABLE'
		  and c.table_schema in ('arm', 'doc', 'ref', 'stock', 'integration')
		  and not exists (select 1 from information_schema.columns d
		                   where d.table_schema = c.table_schema and d.table_name = c.table_name
		                     and d.column_name = 'deleted_by_id')`).Scan(&missing); err != nil {
		t.Fatalf("проверка колонок аудита: %v", err)
	}
	if missing != 0 {
		t.Errorf("таблиц с deleted без deleted_by_id: %d", missing)
	}

	var offers int
	if err := pool.QueryRow(ctx, `select count(*) from information_schema.tables
		where table_schema = 'ref' and table_name = 'supplier_offer'`).Scan(&offers); err != nil {
		t.Fatalf("проверка ref.supplier_offer: %v", err)
	}
	if offers != 1 {
		t.Errorf("таблица ref.supplier_offer не найдена")
	}
}
