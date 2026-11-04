-- +goose Up
-- Миграция 0006: Возвраты (C1, C2, M16, K6). Документы возврата от клиента и поставщику.
-- Соответствует агрегату ReturnRequest в DDD-модели.

-- +goose StatementBegin
create table doc.return_order (
  id              uuid primary key default uuidv7(),
  onec_record_id  text,
  onec_key        text not null default 'app:' || gen_random_uuid()::text,
  version         bigint not null default 1,
  deleted         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  import_batch_id uuid,

  -- Шапка
  number            text,
  date              timestamptz,
  operation         text not null check (operation in ('Закупка', 'Продажа')),
  customer_order_id uuid references doc.customer_order (id),
  supplier_order_id uuid references doc.supplier_order (id),
  customer_id       uuid references ref.counterparty (id),
  supplier_id       uuid references ref.counterparty (id),
  warehouse_id      uuid references ref.warehouse (id),
  total_sum         numeric(18,2) not null default 0,
  total_qty         numeric(18,4) not null default 0,
  comment           text,
  posted            boolean not null default false,
  post_by_id        uuid references auth."user" (id),
  post_date         timestamptz
);
create index return_order_customer on doc.return_order (customer_id) where operation = 'Продажа';
create index return_order_supplier on doc.return_order (supplier_id) where operation = 'Закупка';
create index return_order_posted   on doc.return_order (posted);
comment on table doc.return_order is 'Документ возврата (от клиента или поставщику)';

create table doc.return_line (
  id              uuid primary key default uuidv7(),
  onec_record_id  text,
  onec_key        text not null default 'app:' || gen_random_uuid()::text,
  version         bigint not null default 1,
  deleted         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  import_batch_id uuid,

  return_order_id uuid not null references doc.return_order (id),
  sort_order      integer not null default 0,

  -- Строка
  nomenclature_id uuid references ref.nomenclature (id),
  quantity        numeric(18,4) not null default 0,
  cost_price      numeric(18,2) not null default 0,
  cost_sum        numeric(18,2) not null default 0,
  batch_id        uuid references ref.batch (id),

  -- Связь с исходной строкой АРМ
  source_line_id  uuid references arm.line (id),

  -- Причина возврата (соответствует статусу «Возврат» в 1С)
  reason          text,
  comment         text
);
create index return_line_order on doc.return_line (return_order_id);
create index return_line_nomenclature on doc.return_line (nomenclature_id);
comment on table doc.return_line is 'Строки возврата';
-- +goose StatementEnd

-- +goose Down
drop index if exists doc.return_line_nomenclature;
drop index if exists doc.return_line_order;
drop table if exists doc.return_line;
drop index if exists doc.return_order_posted;
drop index if exists doc.return_order_supplier;
drop index if exists doc.return_order_customer;
drop table if exists doc.return_order;
