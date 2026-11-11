-- +goose Up
-- ФТ v2 п. 13 «Комментарий и доп. признак»: в строке заказа — признак-флажок
-- (бывшая колонка AD файла-реестра) как дополнительный реквизит.
-- В 1С такой реквизит настраивается дополнительно, здесь — колонка arm.line
-- и поле регистра «ДопПризнак» (расширение Fields в backend/internal/arm/extra_fields.go).
alter table arm.line add column if not exists extra_flag boolean not null default false;
comment on column arm.line.extra_flag is 'Доп. признак строки (бывшая колонка AD файла-реестра), ФТ v2 п. 13';

-- Представление API отдаёт признак ключом extraFlag (строка АРМ в PWA).
create or replace view arm.line_api as
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
    'comment', coalesce(l.comment, ''), 'comment2', coalesce(l.comment2, ''), 'extraFlag', coalesce(l.extra_flag, false), 'version', l.version
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
alter table arm.line drop column if exists extra_flag;
