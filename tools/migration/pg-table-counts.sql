-- Точное число строк каждой таблицы базы 1С (инвентаризация, проверка G0.5). Только чтение.
-- Каждая таблица считается отдельным запросом (\gexec, автофиксация): один запрос по 11 тыс. таблиц
-- упирается в max_locks_per_transaction.
-- psql -h localhost -p 5433 -U postgres -d vitauto_dev -At -F ';' -f tools/migration/pg-table-counts.sql > docs/migration/source/pg-counts-vitauto_dev.csv
select format('select %L, count(*), pg_total_relation_size(%L::regclass) from %I.%I', t.table_name, t.table_schema || '.' || t.table_name, t.table_schema, t.table_name)
from information_schema.tables t
where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
order by t.table_name
\gexec
