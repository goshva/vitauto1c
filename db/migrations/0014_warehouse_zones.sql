-- +goose Up
-- Миграция 0014: шесть зон склада по утверждённой схеме (process.html, вкладка «Складские зоны»).
-- Зоны — предопределённый справочник: Зона приёмки, Малый склад, Большой склад,
-- Неопознанные и возвраты, Ремонтная зона, Зона укомплектованных.

create table if not exists ref.warehouse_zone (
    id         uuid primary key,
    code       text not null unique,
    name       text not null,
    purpose    text,
    sort       integer not null default 0,
    deleted    boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
comment on table ref.warehouse_zone is 'Зоны склада (ТЗ 2.4): шесть предопределённых зон по схеме процесса';

insert into ref.warehouse_zone (id, code, name, purpose, sort) values
  ('c2000000-0000-0000-0000-000000000001', 'Z1', 'Зона приёмки',             'Приёмка по УПД, факт прихода',        1),
  ('c2000000-0000-0000-0000-000000000002', 'Z3', 'Малый склад',              'Мелкие детали',                       2),
  ('c2000000-0000-0000-0000-000000000003', 'Z4', 'Большой склад',            'Крупногабарит, жидкости',             3),
  ('c2000000-0000-0000-0000-000000000004', 'Z5', 'Неопознанные и возвраты',  'Брак, возврат, неопознание',          4),
  ('c2000000-0000-0000-0000-000000000005', 'Z7', 'Ремонтная зона',           'Заказ-наряды, механик',               5),
  ('c2000000-0000-0000-0000-000000000006', 'Z9', 'Зона укомплектованных',    'Готово к отгрузке',                   6)
on conflict (code) do update set name = excluded.name, purpose = excluded.purpose, sort = excluded.sort, deleted = false;

alter table ref.storage_cell add column if not exists zone_id uuid references ref.warehouse_zone(id);
comment on column ref.storage_cell.zone_id is 'Зона склада (ref.warehouse_zone); zone — код зоны для совместимости';

-- Связываем существующие ячейки по коду зоны (Z3 и т. п.); неизвестные коды остаются без зоны.
update ref.storage_cell c set zone_id = z.id
  from ref.warehouse_zone z
 where z.code = upper(coalesce(c.zone, '')) and c.zone_id is null;

alter table arm.line add column if not exists zone_id uuid references ref.warehouse_zone(id);
comment on column arm.line.zone_id is 'Зона склада, выбранная в форме резерва/отгрузки';
create index if not exists line_zone_idx on arm.line (zone_id) where zone_id is not null;

alter table doc.shipment add column if not exists zone_id uuid references ref.warehouse_zone(id);
comment on column doc.shipment.zone_id is 'Зона отгрузки (из формы отгрузки)';

-- +goose Down
alter table doc.shipment drop column if exists zone_id;
drop index if exists line_zone_idx;
alter table arm.line drop column if exists zone_id;
alter table ref.storage_cell drop column if exists zone_id;
drop table if exists ref.warehouse_zone;
