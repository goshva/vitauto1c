-- +goose Up
-- Прикладная часть vitauto-api (этап 4): учётные записи и сессии, фоновые задания, очередь документов в бухгалтерию,
-- индексы рабочих запросов и представление строки АРМ в формате REST-контракта PWA (схема Line, api/openapi.yaml).

create table auth.credential (
  login         text primary key,
  user_id       uuid not null references auth."user" (id),
  password_hash text,
  must_change   boolean not null default true,
  created_at    timestamptz not null default now(),
  changed_at    timestamptz
);
comment on table auth.credential is 'Учётные записи входа (пароли 1С не переносятся, ТР-Д10)';
comment on column auth.credential.login is 'Имя для входа — наименование пользователя (как вход PWA в 1С)';
comment on column auth.credential.user_id is 'Пользователь';
comment on column auth.credential.password_hash is 'bcrypt; NULL — пароль не задан (вход по одноразовому коду администратора)';
comment on column auth.credential.must_change is 'При входе потребовать смену пароля';
comment on column auth.credential.created_at is 'Создание учётной записи';
comment on column auth.credential.changed_at is 'Последняя смена пароля';

create table auth.session (
  token      text primary key,
  user_id    uuid not null references auth."user" (id),
  login      text not null,
  role       text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked    boolean not null default false
);
comment on table auth.session is 'Сессии API: Bearer-токен (ТР-Н3)';
comment on column auth.session.token is 'Случайный токен (32 байта, hex)';
comment on column auth.session.user_id is 'Пользователь';
comment on column auth.session.login is 'Имя входа';
comment on column auth.session.role is 'Роль АРМ на момент входа (manager, storekeeper …)';
comment on column auth.session.created_at is 'Вход';
comment on column auth.session.expires_at is 'Окончание действия';
comment on column auth.session.revoked is 'Отозвана (выход, отключение пользователя)';

create table arm.job (
  id          uuid primary key default uuidv7(),
  kind        text not null,
  state       text not null,
  message     text not null default '',
  processed   integer,
  created_by  uuid references auth."user" (id),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
comment on table arm.job is 'Фоновые задания («В работе»): контракт POST /sales/jobs → GET /jobs/{id}';
comment on column arm.job.id is 'Идентификатор задания';
comment on column arm.job.kind is 'Вид задания (in_work)';
comment on column arm.job.state is 'running | done | need_split | failed';
comment on column arm.job.message is 'Итог или причина отказа';
comment on column arm.job.processed is 'Обработано ключей связи';
comment on column arm.job.created_by is 'Кто запустил';
comment on column arm.job.created_at is 'Запуск';
comment on column arm.job.finished_at is 'Окончание';

-- Документы для бухгалтерии (1С): пишутся в транзакции с документом, отправку выполняет коннектор этапа 9
create table integration.outbox (
  id          uuid primary key default uuidv7(),
  target      text not null default 'onec',
  entity      text not null,
  entity_id   uuid not null,
  payload     jsonb not null default '{}',
  status      text not null default 'new',
  attempts    integer not null default 0,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index outbox_status on integration.outbox (status, created_at);
comment on table integration.outbox is 'Очередь документов в бухгалтерию 1С (раздел 14 плана): заказы поставщикам, приходные и расходные накладные';

-- новые объекты получают onec_key «app:<id>» (у перенесённых — ключ записи 1С)
create index line_order on arm.line (customer_order_id);
create index line_link on arm.line (link_key);
create index line_nomenclature on arm.line (nomenclature_id);
create index line_marked on arm.line (marked_by_id) where marked;
create index move_nomenclature on stock.move (nomenclature_id, batch_id);
create index notice_unread on arm.notice (recipient_role) where not is_read;

-- Строка АРМ в формате API (pwa/src/odata/mapping.js toLine); статус — код API через arm.line_status
create view arm.line_api as
select l.id, l.customer_order_id, l.operation, l.status as onec_status, l.marked, l.marked_by_id, l.deleted, l.link_key,
  jsonb_build_object(
    'id', l.id::text, 'linkKey', l.link_key, 'operation', case when l.operation = 'Закупка' then 'purchase' else 'sale' end,
    'status', coalesce(s.api_status, l.status), 'locked', l.status = 'ЗаблокированоФоном', 'deleted', coalesce(l.deleted, false),
    'marked', coalesce(l.marked, false), 'markedBy', mu.name, 'markedById', l.marked_by_id, 'order', l.sort_order, 'hasDeficit', false,
    'manual', coalesce(l.manual_edit, false), 'warehouse', case when w.id is null then null else jsonb_build_object('id', w.id, 'name', w.name) end,
    'cell', case when c.id is null then null else jsonb_build_object('id', c.id, 'code', c.code) end,
    'customerOrder', case when co.id is null then null else jsonb_build_object('id', co.id, 'kind', 'customer_order', 'number', co.number, 'date', to_char(co.date, 'YYYY-MM-DD'), 'posted', co.posted) end,
    'supplierOrder', case when so.id is null then null else jsonb_build_object('id', so.id, 'kind', 'supplier_order', 'number', so.number, 'date', to_char(so.date, 'YYYY-MM-DD'), 'posted', so.posted) end,
    'receipt', case when rc.id is null then null else jsonb_build_object('id', rc.id, 'kind', 'receipt', 'number', rc.number, 'date', to_char(rc.date, 'YYYY-MM-DD'), 'posted', rc.posted) end,
    'shipmentDoc', case when sh.id is null then null else jsonb_build_object('id', sh.id, 'kind', 'shipment', 'number', sh.number, 'date', to_char(sh.date, 'YYYY-MM-DD'), 'posted', sh.posted) end,
    'signedOriginal', coalesce(l.signed_original, false), 'shipmentDate', to_char(l.shipment_date, 'YYYY-MM-DD'), 'shipmentNumber', coalesce(l.shipment_number, ''),
    'orderDate', to_char(l.order_date, 'YYYY-MM-DD'), 'internalOrderNumber', coalesce(l.internal_order_number, ''), 'clientOrderNumber', coalesce(l.client_order_number, ''),
    'customer', case when cu.id is null then null else jsonb_build_object('id', cu.id, 'name', cu.name) end,
    'contract', case when ct.id is null then null else jsonb_build_object('id', ct.id, 'name', ct.name) end,
    'serviceType', case when sk.id is null then null else jsonb_build_object('id', sk.id, 'name', sk.name) end,
    'brand', coalesce(l.brand, ''), 'model', coalesce(l.model, ''), 'aggregate', coalesce(l.aggregate, ''), 'plate', coalesce(l.plate, ''),
    'chassis', coalesce(l.chassis, ''), 'vin', coalesce(l.vin, ''), 'engine', coalesce(l.engine, '')
  ) || jsonb_build_object( -- не больше 100 аргументов на вызов
    'urgency', coalesce(l.urgency, ''), 'vehiclePlate', coalesce(l.vehicle_plate, ''), 'territory', coalesce(l.territory, ''),
    'factName', coalesce(l.fact_name, ''), 'factArticle', coalesce(l.fact_article, ''), 'factQty', coalesce(l.fact_qty, ''), 'factUnit', coalesce(l.fact_unit, ''),
    'nomenclature', case when n.id is null then null else jsonb_build_object('id', n.id, 'name', n.name, 'article', coalesce(n.article, ''),
      'code', coalesce(n.ext_code, ''), 'unit', coalesce(un.name, '')) end,
    'quantity', coalesce(l.quantity, 0), 'normHours', coalesce(l.norm_hours, 0), 'stockQty', coalesce(l.stock_qty, 0),
    'reserveQty', coalesce(l.reserve_qty, 0), 'inTransitQty', coalesce(l.in_transit_qty, 0),
    'batch', case when b.id is null then null else jsonb_build_object('id', b.id, 'name', b.name) end, 'stockCell', coalesce(c.code, l.cell_legacy, ''),
    'costPrice', coalesce(l.cost_price, 0), 'costSum', coalesce(l.cost_sum, 0),
    'paymentForm', case when pf.id is null then null else jsonb_build_object('id', pf.id, 'name', pf.name) end,
    'rrc', coalesce(l.rrc, 0), 'paid', coalesce(l.paid, ''), 'invoiceNumber', coalesce(l.invoice_number, ''), 'invoiceDate', to_char(l.invoice_date, 'YYYY-MM-DD'),
    'coefficient', coalesce(l.coefficient, 0), 'salePrice', coalesce(l.sale_price, 0),
    'saleSum', (case when coalesce(l.norm_hours, 0) > 0 then l.norm_hours else coalesce(l.quantity, 0) end) * coalesce(l.sale_price, 0),
    'supplier', case when sp.id is null then null else jsonb_build_object('id', sp.id, 'name', sp.name) end,
    'receiptDate', to_char(l.receipt_date, 'YYYY-MM-DD'), 'updDate', to_char(l.upd_date, 'YYYY-MM-DD'), 'updNumber', coalesce(l.upd_number, ''),
    'supplierShipTerritory', coalesce(l.supplier_ship_territory, ''), 'supplierOrderDate', to_char(l.supplier_order_date, 'YYYY-MM-DD'),
    'deliveryTerm', to_char(l.delivery_term, 'YYYY-MM-DD'), 'assemblySentDate', to_char(l.assembly_sent_date, 'YYYY-MM-DD'),
    'comment', coalesce(l.comment, ''), 'comment2', coalesce(l.comment2, ''), 'version', l.version
  ) as api
from arm.line l
left join arm.line_status s on s.name = l.status
left join auth."user" mu on mu.id = l.marked_by_id
left join doc.customer_order co on co.id = l.customer_order_id
left join doc.supplier_order so on so.id = l.supplier_order_id
left join doc.receipt rc on rc.id = l.receipt_id
left join doc.shipment sh on sh.id = l.shipment_doc_id
left join ref.counterparty cu on cu.id = l.customer_id
left join ref.contract ct on ct.id = l.contract_id
left join ref.service_kind sk on sk.id = l.service_type_id
left join ref.nomenclature n on n.id = l.nomenclature_id
left join ref.unit un on un.id = n.unit_id
left join ref.batch b on b.id = l.batch_id
left join ref.payment_form pf on pf.id = l.payment_form_id
left join ref.counterparty sp on sp.id = l.supplier_id
left join ref.warehouse w on w.id = l.warehouse_id
left join ref.storage_cell c on c.id = l.cell_id;
comment on view arm.line_api is 'Строка АРМ в формате REST API PWA (схема Line): GET /lines, /lines/{id}';

-- +goose Down
drop view if exists arm.line_api;
drop index if exists arm.notice_unread;
drop index if exists stock.move_nomenclature;
drop index if exists arm.line_marked;
drop index if exists arm.line_nomenclature;
drop index if exists arm.line_link;
drop index if exists arm.line_order;
drop table if exists integration.outbox;
drop table if exists arm.job;
drop table if exists auth.session;
drop table if exists auth.credential;
