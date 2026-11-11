-- +goose Up
-- Аудит удалений (ТЗ: любое удаление, на которое у роли есть право, — мягкое,
-- с указанием автора и времени). У всех таблиц с флагом deleted появляются
-- deleted_by_id (кто) и deleted_at (когда); восстановление их очищает.

-- +goose StatementBegin
do $$
declare
  r record;
begin
  for r in
    select c.table_schema, c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.column_name = 'deleted'
       and c.table_schema in ('arm', 'doc', 'ref', 'stock', 'integration')
       and t.table_type = 'BASE TABLE'
  loop
    execute format('alter table %I.%I add column if not exists deleted_by_id uuid', r.table_schema, r.table_name);
    execute format('alter table %I.%I add column if not exists deleted_at timestamptz', r.table_schema, r.table_name);
    execute format('comment on column %I.%I.deleted_by_id is ''Кто пометил запись удалённой''', r.table_schema, r.table_name);
    execute format('comment on column %I.%I.deleted_at is ''Когда запись помечена удалённой''', r.table_schema, r.table_name);
  end loop;
end $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
do $$
declare
  r record;
begin
  for r in
    select c.table_schema, c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.column_name = 'deleted_by_id'
       and c.table_schema in ('arm', 'doc', 'ref', 'stock', 'integration')
       and t.table_type = 'BASE TABLE'
  loop
    execute format('alter table %I.%I drop column if exists deleted_at', r.table_schema, r.table_name);
    execute format('alter table %I.%I drop column if exists deleted_by_id', r.table_schema, r.table_name);
  end loop;
end $$;
-- +goose StatementEnd
