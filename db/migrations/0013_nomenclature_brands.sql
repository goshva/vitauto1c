-- +goose Up
-- Миграция 0013: карточка номенклатуры по ТЗ 2.1/2.2 — бренды, статус поиска,
-- принадлежность, кросс-код (прямая связь «аналог ↔ аналог») и вложения (фото).

create table if not exists ref.brand (
    id          uuid primary key,
    onec_version text,
    deleted     boolean not null default false,
    predefined  uuid,
    code        text,
    name        text not null,
    country     text,
    comment     text,
    version     bigint not null default 1,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    extra       jsonb not null default '{}'::jsonb,
    import_batch_id uuid,
    onec_key    text
);
comment on table ref.brand is 'Бренды номенклатуры (ТЗ 2.2): справочник, поле «Аналоги» — отдельная связка брендов';
comment on column ref.brand.country is 'Страна бренда (необязательно)';

create unique index if not exists brand_name_uniq on ref.brand (lower(name)) where not deleted;
create index if not exists brand_deleted_idx on ref.brand (deleted);

alter table ref.nomenclature
    add column if not exists brand_id uuid references ref.brand(id),
    add column if not exists search_status text,
    add column if not exists ownership text,
    add column if not exists analog_id uuid references ref.nomenclature(id);

comment on column ref.nomenclature.brand_id is 'Бренд (ТЗ 2.1): обязателен для товаров, справочник ref.brand';
comment on column ref.nomenclature.search_status is 'Статус поиска (ТЗ 2.1): «В работе» / «Найден» / «Не опознан»';
comment on column ref.nomenclature.ownership is 'Принадлежность (ТЗ 2.1): «Заказная» / «Закупочная» / «Тендерная»';
comment on column ref.nomenclature.analog_id is 'Кросс-код (ТЗ 2.1, 7.3): прямая связь с другой карточкой, без дерева аналогов';

alter table ref.nomenclature add constraint nomenclature_search_status_chk
    check (search_status is null or search_status in ('В работе', 'Найден', 'Не опознан'));
alter table ref.nomenclature add constraint nomenclature_ownership_chk
    check (ownership is null or ownership in ('Заказная', 'Закупочная', 'Тендерная'));
alter table ref.nomenclature add constraint nomenclature_analog_self_chk
    check (analog_id is null or analog_id <> id);

create unique index if not exists nomenclature_analog_uniq on ref.nomenclature (analog_id) where analog_id is not null;
create index if not exists nomenclature_brand_idx on ref.nomenclature (brand_id) where brand_id is not null;

create table if not exists ref.attachment (
    id           uuid primary key,
    owner_type   text not null,
    owner_id     uuid not null,
    file_name    text not null,
    content_type text not null default 'application/octet-stream',
    size         bigint not null default 0,
    data         bytea not null,
    author_id    uuid,
    deleted      boolean not null default false,
    created_at   timestamptz not null default now()
);
comment on table ref.attachment is 'Вложения карточек (ТЗ 2.1: фото неопознанных и номенклатуры)';
create index if not exists attachment_owner_idx on ref.attachment (owner_type, owner_id) where not deleted;

-- +goose Down
drop table if exists ref.attachment;
drop index if exists nomenclature_analog_uniq;
drop index if exists nomenclature_brand_idx;
alter table ref.nomenclature
    drop constraint if exists nomenclature_analog_self_chk,
    drop constraint if exists nomenclature_ownership_chk,
    drop constraint if exists nomenclature_search_status_chk,
    drop column if exists analog_id,
    drop column if exists ownership,
    drop column if exists search_status,
    drop column if exists brand_id;
drop table if exists ref.brand;
