-- ============================================================
-- ПОЛНЫЙ SEED ДЛЯ vitauto_app
-- Очистка → demo-app → demo-stages → demo-data
-- Идемпотентен: повторный запуск не создаёт дубликатов.
-- ============================================================

BEGIN;

-- ============================================================
-- ШАГ 0: ОЧИСТКА демо-данных (обратный порядок зависимостей)
-- ============================================================

-- Возвраты (нет unique на onec_key, чистим по onec_key явно)
delete from doc.return_line where onec_key like 'demo:rel:%';
delete from doc.return_order where onec_key like 'demo:ret:%';

-- Строки заданий на наряды
delete from doc.work_order_line where onec_key like 'demo:wol:%';
delete from doc.work_order_labor where onec_key like 'demo:wal:%';
delete from doc.work_order where onec_key like 'demo:wo:%';

-- Строки АРМ и уведомления
delete from arm.notice where onec_key like 'demo:notice:%';
delete from arm.line where onec_key like 'demo:%';

-- Документы (фикс. id)
delete from doc.shipment where id::text like 'd1000000%';
delete from doc.receipt where id::text like 'c1000000%';
delete from doc.supplier_order where id::text like 'b0000000%';
delete from doc.customer_order where id::text like 'a0000000%';

-- ============================================================
-- ШАГ 1: Пользователи, роли, справочники, НСИ
-- ============================================================

\i seed/demo-app.sql

-- ============================================================
-- ШАГ 2: Стадии всех сценариев (140 строк)
-- ============================================================

\i seed/demo-stages.sql

-- ============================================================
-- ШАГ 3: Сценарии + документы + work_order + возвраты
-- ============================================================

\i seed/demo-data.sql

COMMIT;
