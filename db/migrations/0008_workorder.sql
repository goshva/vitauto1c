-- +goose Up
-- Миграция 0008: ремонтная зона (G1–G9): заказ-наряд, выдача запчастей в ремонт, нормо-часы по типу техники.
-- Соответствует агрегатам WorkOrder/LaborHours (docs/migration/ddd/node-map.json).

create table doc.work_order (
  id                uuid primary key default uuidv7(),
  onec_key          text not null unique default 'app:' || gen_random_uuid()::text,
  version           bigint not null default 1,
  deleted           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  import_batch_id   uuid,

  number            text,
  date              timestamptz,
  posted            boolean not null default false,
  car_id            uuid references ref.car (id),
  customer_id       uuid references ref.counterparty (id),
  customer_order_id uuid references doc.customer_order (id),
  warehouse_id      uuid references ref.warehouse (id),      -- склад-источник выдачи запчастей
  responsible_id    uuid references auth."user" (id),        -- главный механик
  author_id         uuid references auth."user" (id),
  total_norm_hours  numeric(15,3) not null default 0,
  labor_sum         numeric(15,2) not null default 0,        -- стоимость нормо-часов
  parts_sum         numeric(15,2) not null default 0,        -- стоимость выданных запчастей
  status            text not null default 'open' check (status in ('open', 'released')),
  released_at       timestamptz,                             -- G9: авто выдано
  comment           text
);
create index work_order_car on doc.work_order (car_id);
create index work_order_open on doc.work_order (status) where status = 'open';
comment on table doc.work_order is 'Заказ-наряд ремонтной зоны (G1): запчасти выдаются в ремонт по заказ-наряду';

-- Строки заказ-наряда: строки АРМ (услуги/работы), выданные в ремонтную зону
create table doc.work_order_line (
  id              uuid primary key default uuidv7(),
  onec_key        text not null unique default 'app:' || gen_random_uuid()::text,
  version         bigint not null default 1,
  deleted         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  work_order_id   uuid not null references doc.work_order (id),
  line_id         uuid references arm.line (id),
  nomenclature_id uuid references ref.nomenclature (id),
  quantity        numeric(15,3) not null default 0,
  norm_hours      numeric(15,3) not null default 0,
  comment         text
);
create index work_order_line_order on doc.work_order_line (work_order_id);
create index work_order_line_line  on doc.work_order_line (line_id);
comment on table doc.work_order_line is 'Строки заказ-наряда: работы и выданные в ремонт запчасти';

-- Нормо-часы по видам работ; стоимость часа — по типу техники (ref.car_model.in_works, G5)
create table doc.work_order_labor (
  id               uuid primary key default uuidv7(),
  onec_key         text not null unique default 'app:' || gen_random_uuid()::text,
  version          bigint not null default 1,
  deleted          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  work_order_id    uuid not null references doc.work_order (id),
  service_kind_id  uuid references ref.service_kind (id),
  model_id         uuid references ref.car_model (id),        -- тип техники (для цены часа)
  quantity         numeric(15,3) not null default 0,          -- нормо-часы
  hour_price       numeric(15,2) not null default 0,          -- цена часа (ref.labor_price)
  amount           numeric(15,2) not null default 0,
  comment          text
);
create index work_order_labor_order on doc.work_order_labor (work_order_id);
comment on table doc.work_order_labor is 'Нормо-часы заказ-наряда; стоимость часа — по типу техники (G5)';

-- +goose Down
drop index if exists doc.work_order_labor_order;
drop table if exists doc.work_order_labor;
drop index if exists doc.work_order_line_line;
drop index if exists doc.work_order_line_order;
drop table if exists doc.work_order_line;
drop index if exists doc.work_order_open;
drop index if exists doc.work_order_car;
drop table if exists doc.work_order;
