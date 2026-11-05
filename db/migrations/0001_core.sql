-- +goose Up
-- Базовая схема vitauto_app (план, разделы 5–6): схемы, архив 1С, служебные таблицы и функции перевода значений 1С.
create extension if not exists "uuid-ossp";

create schema if not exists ref;
create schema if not exists doc;
create schema if not exists stock;
create schema if not exists arm;
create schema if not exists imp;
create schema if not exists auth;
create schema if not exists integration;
create schema if not exists sys;
create schema if not exists legacy;
create schema if not exists onec;

-- Сырые строки таблиц хранения 1С (шаг extract): to_jsonb каждой строки источника. Пересоздаётся каждым прогоном.
create table onec.raw (
  storage text not null,          -- таблица хранения 1С в нижнем регистре: _reference368x1
  row     jsonb not null
);
create index raw_storage on onec.raw (storage);
comment on table onec.raw is 'Сырые строки таблиц 1С (to_jsonb) последнего прогона мигратора; источник для legacy и load';

-- Номер типа ссылки 1С (_RTRef, _TYPE) -> объект метаданных и целевая таблица
create table onec.type_map (
  type_no integer primary key,    -- число из имени таблицы: _Reference368X1 -> 368
  storage text not null,
  object  text not null,          -- Справочник.Номенклатура
  target  text                    -- ref.nomenclature, если объект переносится в типизированную таблицу
);
comment on table onec.type_map is 'Номер типа ссылки 1С (_RTRef) -> объект метаданных и целевая таблица vitauto_app';

-- Значения перечислений 1С: хранится имя значения (план, раздел 5.3)
create table sys.enum_value (
  id    uuid primary key,         -- UUID значения перечисления в 1С
  enum  text not null,            -- Перечисление.Арм_СтатусыАРМ
  name  text not null,            -- ВРаботе
  ord   integer not null,
  unique (enum, name)
);
comment on table sys.enum_value is 'Значения перечислений 1С: UUID, перечисление, имя значения, порядок (_EnumOrder)';

-- Полный архив 1С: каждая запись каждого непустого объекта (план, раздел 2, ТР-Д3)
create table legacy.object (
  kind   text not null,           -- Справочник | Документ | РегистрСведений | РегистрНакопления | Константа | ...
  name   text not null,           -- полное имя объекта метаданных
  key    text not null,           -- UUID ссылки или ключ записи регистра
  data   jsonb not null,          -- все реквизиты (имена 1С), табличные части, ссылки — UUID
  hash   text not null,           -- sha256 канонического data (сверка R3)
  run_id uuid not null,
  primary key (kind, name, key)
);
create index legacy_object_name on legacy.object (name);
comment on table legacy.object is 'Архив 1С: каждая запись каждого непустого объекта метаданных (ТР-Д3)';

create table sys.migration_run (
  id          uuid primary key default uuidv7(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  source      text not null,      -- база 1С (vitauto_dev)
  step        text not null,      -- extract | legacy | load | derive | reconcile
  status      text not null default 'running',
  stats       jsonb not null default '{}'
);
comment on table sys.migration_run is 'Протокол шагов мигратора (план, раздел 7.1, A7)';

create table sys.setting (
  key   text primary key,
  value jsonb not null
);

-- Перевод значений 1С в SQL (тот же алгоритм, что backend/internal/onec и tools/migration/onec-uuid.mjs)
-- +goose StatementBegin
create function onec.uuid(b bytea) returns uuid language sql immutable strict as $$
  select case when b = '\x00000000000000000000000000000000'::bytea then null else
    (substr(h,25,8)||'-'||substr(h,21,4)||'-'||substr(h,17,4)||'-'||substr(h,1,4)||'-'||substr(h,5,12))::uuid end
  from encode(b,'hex') h
$$;
-- +goose StatementEnd
-- +goose StatementBegin
-- bytea из to_jsonb приходит строкой '\x…'
create function onec.uuid(s text) returns uuid language sql immutable strict as $$
  select onec.uuid(decode(substr(s, 3), 'hex'))
$$;
-- +goose StatementEnd
-- +goose StatementBegin
create function onec.type_no(s text) returns integer language sql immutable strict as $$
  select ('x' || substr(s, 3))::bit(32)::integer
$$;
-- +goose StatementEnd
-- +goose StatementBegin
-- пустая дата 1С -> NULL
create function onec.ts(s text) returns timestamp language sql immutable strict as $$
  select case when s like '0001-01-01%' then null else s::timestamp end
$$;
-- +goose StatementEnd

-- +goose Down
drop schema if exists onec, legacy, sys, integration, auth, imp, arm, stock, doc, ref cascade;
