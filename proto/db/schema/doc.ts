import { boolean, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Документы продажи и закупки. В legacy это 5 шапок + 5 таблиц строк (до 45 столбцов
// каждая) плюс 1С-обвязка: onec_version, extra, import_batch_id, base_doc_type/id/value,
// order_state_type/id/value, currency_id, author_id, responsible_id.
//
// В прототипе каждая шапка — ~12 столбцов: остальное вычисляется, а «состояние
// документа» выражается через его строки и статусы. Связь с строками — FK в самой
// строке (`line.customer_order_id` и т.д.), таблиц строк документа нет.
//
// Ремонт, уведомления и задания — в `work.ts`.

const stamp = () => ({
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Заказ покупателя. 12 столбцов вместо 32.
export const customerOrder = pgTable(
  'customer_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number'),
    date: timestamp('date').notNull().defaultNow(),
    operation: text('operation').$type<'sale' | 'purchase'>(),
    clientOrderNumber: text('client_order_number'),
    counterpartyId: uuid('counterparty_id'),
    contractId: uuid('contract_id'),
    organizationId: uuid('organization_id'),
    shipDate: timestamp('ship_date'),
    total: numeric('total', { precision: 15, scale: 2 }),
    ...stamp(),
  },
  (t) => [index('customer_order_number_idx').on(t.number)],
);

// Заказ поставщику. 13 столбцов вместо 31.
//
// `status` — состояние документа: P1 «подтверждён» → приёмка → отмена.
// Процесс «Отмена заказа у поставщика» без него не выражается: раньше отмена
// была просто кнопкой, и чем заказ отличался до и после неё — неизвестно.
export const supplierOrder = pgTable(
  'supplier_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number'),
    date: timestamp('date').notNull().defaultNow(),
    status: text('status')
      .$type<'new' | 'confirmed' | 'received' | 'cancelled'>()
      .notNull().default('new'),
    operation: text('operation').$type<'sale' | 'purchase'>(),
    counterpartyId: uuid('counterparty_id'),
    contractId: uuid('contract_id'),
    organizationId: uuid('organization_id'),
    customerOrderId: uuid('customer_order_id'),
    receiptDate: timestamp('receipt_date'),
    total: numeric('total', { precision: 15, scale: 2 }),
    ...stamp(),
  },
  (t) => [
    index('supplier_order_number_idx').on(t.number),
    index('supplier_order_status_idx').on(t.status),
  ],
);

// Приёмка. 12 столбцов вместо 32 + 36 + 27.
export const receipt = pgTable(
  'receipt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number'),
    date: timestamp('date').notNull().defaultNow(),
    operation: text('operation').$type<'sale' | 'purchase'>(),
    counterpartyId: uuid('counterparty_id'),
    contractId: uuid('contract_id'),
    organizationId: uuid('organization_id'),
    warehouseId: uuid('warehouse_id'),
    total: numeric('total', { precision: 15, scale: 2 }),
    posted: boolean('posted').notNull().default(false),
    ...stamp(),
  },
  (t) => [index('receipt_number_idx').on(t.number)],
);

// Отгрузка. 13 столбцов вместо 32 + 36.
//
// `status` — состояние ДОКУМЕНТА, отдельно от статуса строк:
// K5 «создана» → M12 «отгружена» → M15 «закрыта» (документы проверены).
// Статус строки говорит, где товар; состояние отгрузки — где документ.
export const shipment = pgTable(
  'shipment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number'),
    date: timestamp('date').notNull().defaultNow(),
    status: text('status').$type<'new' | 'shipped' | 'closed'>().notNull().default('new'),
    operation: text('operation').$type<'sale' | 'purchase'>(),
    counterpartyId: uuid('counterparty_id'),
    contractId: uuid('contract_id'),
    organizationId: uuid('organization_id'),
    customerOrderId: uuid('customer_order_id'),
    warehouseId: uuid('warehouse_id'),
    zoneId: uuid('zone_id'),
    // Автомобиль отгрузки: через него строке доступны атрибуты авто
    // (марка, VIN, двигатель), которые в legacy лежали прямо в `arm.line` (47–57).
    carId: uuid('car_id'),
    total: numeric('total', { precision: 15, scale: 2 }),
    ...stamp(),
  },
  (t) => [
    index('shipment_number_idx').on(t.number),
    index('shipment_status_idx').on(t.status),
  ],
);

// Возврат. 11 столбцов вместо 24 + 20.
//
// `kind` различает ТРИ процесса возврата, которые в legacy были одной формой с
// разными кнопками, а в модели — тремя сценариями:
//   client   — «Возврат от клиента» (N3)
//   supplier — «Возврат поставщику (от менеджера)» (M16)
//   internal — «Отказ клиента при получении товара» (N2a)
// Без этого поля API не может отличить один возврат от другого.
export const returnOrder = pgTable(
  'return_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number'),
    date: timestamp('date').notNull().defaultNow(),
    kind: text('kind').$type<'client' | 'supplier' | 'internal'>(),
    // Состояние возврата: N3 «оформлен» → K6 «принят» → M19/M16 «поставщику» → P3 «закрыт».
    // Без него путь возврата не отследить: статус СТРОКИ говорит, где товар,
    // а не где документ возврата.
    status: text('status').$type<'new' | 'accepted' | 'to_supplier' | 'closed'>()
      .notNull().default('new'),
    operation: text('operation').$type<'sale' | 'purchase'>(),
    counterpartyId: uuid('counterparty_id'),
    contractId: uuid('contract_id'),
    organizationId: uuid('organization_id'),
    warehouseId: uuid('warehouse_id'),
    total: numeric('total', { precision: 15, scale: 2 }),
    ...stamp(),
  },
  (t) => [
    index('return_order_number_idx').on(t.number),
    index('return_order_kind_idx').on(t.kind),
    index('return_order_status_idx').on(t.status),
  ],
);
