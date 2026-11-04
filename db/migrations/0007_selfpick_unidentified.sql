-- +goose Up
-- Миграция 0007: самовывоз (N4/K9/M17) и неопознанные позиции (M18/A1/K8).

-- N4: флаг самовывоза на строке АРМ — отгрузка без транспорта (K9 приёмка кладовщиком, M17 уведомление менеджеру)
alter table arm.line add column self_pickup boolean not null default false;
comment on column arm.line.self_pickup is 'Самовывоз (N4): отгрузка без доставки, K9/M17';
create index line_self_pickup on arm.line (self_pickup) where self_pickup;

-- M18/A1/K8: неопознанная позиция с фотофиксацией
create table doc.unidentified_item (
  id              uuid primary key default uuidv7(),
  onec_key        text not null unique default 'app:' || gen_random_uuid()::text,
  version         bigint not null default 1,
  deleted         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  import_batch_id uuid,

  line_id         uuid references arm.line (id),   -- строка АРМ, где позиция не опознана
  source          text not null default 'line' check (source in ('line', 'stock', 'workshop')),
  -- черновые данные с глаз/фото (как fact_* в arm.line)
  fact_name       text not null default '',
  fact_article    text not null default '',
  fact_qty        text not null default '',
  fact_unit       text not null default '',
  photo_urls      jsonb not null default '[]',     -- [{url, name, uploaded_at}]
  comment         text,
  -- результат розыска: null — ищется, nomenclature_id — привязана (A2 подтверждение не требуется, это привязка к рабочей позиции)
  nomenclature_id uuid references ref.nomenclature (id),
  resolved_by_id  uuid references auth."user" (id),
  resolved_at     timestamptz,
  found           boolean not null default false   -- K8: найдена на складе (→ K2) без привязки новой позиции
);
create index unidentified_open on doc.unidentified_item (created_at) where nomenclature_id is null and not found and not deleted;
comment on table doc.unidentified_item is 'Неопознанная позиция (M18/A1/K8): фотофиксация, розыск, привязка к номенклатуре';

-- +goose Down
drop index if exists doc.unidentified_open;
drop table if exists doc.unidentified_item;
drop index if exists arm.line_self_pickup;
alter table arm.line drop column if exists self_pickup;
