-- +goose Up
-- Доменные дополнения к перенесённым таблицам (план, разделы 5.3, 6, 13): склады и ячейки, статусы строк, остатки.

-- Склады (СтруктурныеЕдиницы): признак склада и основного склада заполняет `vitauto-migrator derive`
alter table ref.warehouse add column is_warehouse boolean not null default false;
alter table ref.warehouse add column is_main boolean not null default false;
create unique index warehouse_one_main on ref.warehouse (is_main) where is_main;
comment on column ref.warehouse.is_warehouse is 'ТипСтруктурнойЕдиницы = Склад (derive)';
comment on column ref.warehouse.is_main is 'Основной склад: ровно один (инвариант агрегата Warehouse)';

-- Ячейки склада (новый справочник; в 1С — строка ЯчейкаСклада в строке АРМ, справочник «Ячейки» пуст)
create table ref.storage_cell (
  id              uuid primary key default uuidv7(),
  warehouse_id    uuid not null references ref.warehouse (id),
  code            text not null,
  zone            text,
  capacity        numeric(15,3),
  blocked         boolean not null default false,
  version         bigint not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted         boolean not null default false,
  extra           jsonb not null default '{}',
  import_batch_id uuid,
  unique (warehouse_id, code)
);
comment on table ref.storage_cell is 'Ячейки склада (план, раздел 13); первичное заполнение — уникальные ЯчейкаСклада строк АРМ (derive)';
comment on column ref.storage_cell.zone is 'Зона склада process.html (Z3 малый склад, Z8 резерв / комплектация, Z9 укомплектованные …)';
comment on column ref.storage_cell.id is 'UUID ячейки; при переносе — v5(склад:код), новые — uuidv7';
comment on column ref.storage_cell.warehouse_id is 'Склад ячейки';
comment on column ref.storage_cell.code is 'Код ячейки (A-01-03); 1С: ЯчейкаСклада строки АРМ';
comment on column ref.storage_cell.capacity is 'Вместимость (необязательно)';
comment on column ref.storage_cell.blocked is 'Заблокирована: размещение запрещено';
comment on column ref.storage_cell.version is 'версия строки: оптимистическая блокировка, события WS';
comment on column ref.storage_cell.created_at is 'создание записи в vitauto_app';
comment on column ref.storage_cell.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.storage_cell.deleted is 'пометка удаления';
comment on column ref.storage_cell.extra is 'дополнительные свойства';
comment on column ref.storage_cell.import_batch_id is 'партия импорта, создавшая или изменившая запись';

-- Строки АРМ: склад и ячейка
alter table arm.line add column warehouse_id uuid references ref.warehouse (id) deferrable initially deferred;
alter table arm.line add column cell_id uuid references ref.storage_cell (id) deferrable initially deferred;
comment on column arm.line.warehouse_id is 'Склад строки (раздел 13); при переносе — основной склад';
comment on column arm.line.cell_id is 'Ячейка из справочника ref.storage_cell; исходная строка 1С — cell_legacy';

-- Статусы строки: одна запись на значение Арм_СтатусыАРМ; в строке хранится имя 1С, API получает api_status
create table arm.line_status (
  name       text primary key,   -- значение 1С: ВРаботе, Подготовлено, Собран …
  api_status text not null,      -- код матрицы и API: in_work, ready_to_ship …
  title      text not null,
  ord        integer not null
);
comment on column arm.line_status.name is '1С: значение перечисления Арм_СтатусыАРМ';
comment on column arm.line_status.api_status is 'Код статуса матрицы и API (domain-model.json)';
comment on column arm.line_status.title is 'Название статуса';
comment on column arm.line_status.ord is 'Порядок статуса в матрице';
comment on table arm.line_status is 'Значения Арм_СтатусыАРМ и их коды API (domain-model.json statuses.onecEnums); Подготовлено и Собран -> ready_to_ship без потери исходного значения';

-- Остатки: сумма движений stock.move по ключу (приход — movement 0, расход — 1)
create view stock.balance as
select warehouse_type, warehouse_id, nomenclature_id, batch_id, customer_order,
       sum(case when movement = 0 then qty else -qty end) as qty,
       sum(case when movement = 0 then amount else -amount end) as amount
from stock.move
where active
group by warehouse_type, warehouse_id, nomenclature_id, batch_id, customer_order;
comment on view stock.balance is 'Остатки по ключу склад / номенклатура / партия / заказ (сверка R5 с регистром Запасы 1С)';

-- +goose Down
drop view if exists stock.balance;
drop table if exists arm.line_status;
alter table arm.line drop column if exists cell_id;
alter table arm.line drop column if exists warehouse_id;
drop table if exists ref.storage_cell;
alter table ref.warehouse drop column if exists is_main;
alter table ref.warehouse drop column if exists is_warehouse;
