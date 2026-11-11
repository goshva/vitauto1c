-- +goose Up
-- Варианты поставки (ТЗ п. 12): на одну номенклатуру — несколько поставщиков
-- с ценой и сроком поставки. Менеджер выбирает вариант в строке закупки;
-- выбранный вариант проставляется в строку (С1 supplier, С7 delivery_term).
create table if not exists ref.supplier_offer (
    id              uuid primary key,
    nomenclature_id uuid not null references ref.nomenclature(id),
    supplier_id     uuid not null references ref.counterparty(id),
    price           numeric not null default 0,
    delivery_term   timestamptz,
    comment         text,
    deleted         boolean not null default false,
    deleted_by_id   uuid,
    deleted_at      timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
comment on table ref.supplier_offer is 'Предложения поставщиков: цена и срок по номенклатуре (ТЗ п. 12 «Варианты поставки»)';
comment on column ref.supplier_offer.price is 'Цена предложения (закупочная)';
comment on column ref.supplier_offer.delivery_term is 'Срок поставки по предложению';

create unique index if not exists supplier_offer_uniq
    on ref.supplier_offer (nomenclature_id, supplier_id) where not deleted;
create index if not exists supplier_offer_nom_idx
    on ref.supplier_offer (nomenclature_id) where not deleted;

-- +goose Down
drop table if exists ref.supplier_offer;
