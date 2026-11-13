import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Ядро прототипа: `arm.line` (82 столбца) разрезан по карте prototype-spec.md §4.2.
//   L (35) → line        — собственно строка
//   F  (6) → line_fact   — данные заявки «как написал клиент»
//   M  (2) → line_mark   — состояние сессии (отметки), не данные строки
//   V  (8) → line_view   — вычисляемое: остатки, суммы, цены
//   D (13) → doc.*       — поля документа, дублированные в строку
//   R  (7) → ref.*       — марка, VIN, двигатель, батч, ячейка
//   ✗ (11) → удалено     — наследие 1С
//
// Имена столбцов в БД оставлены прежними (snake_case), чтобы миграция данных
// и ручная сверка были возможны. В TypeScript — camelCase, как принято в Drizzle.

export const line = pgTable(
  'line',
  {
    // --- собственно строка (L) ---
    id: uuid('id').primaryKey().defaultRandom(),
    customerOrderId: uuid('customer_order_id'),
    supplierOrderId: uuid('supplier_order_id'),
    receiptId: uuid('receipt_id'),
    shipmentId: uuid('shipment_doc_id'),
    // Ссылка на возврат — НОВЫЙ столбец, которого не было в исходных 82.
    // В legacy связь «возврат ↔ строки» жила в отдельной таблице `doc.return_line`.
    // Прототип держит ссылки на документы в самой строке (заказ, приёмка, отгрузка),
    // и возврат — пятая по счёту: отдельная таблица ради одной связи не нужна,
    // а `line` уже накапливает эти ссылки по мере движения товара.
    returnId: uuid('return_id'),
    // Ссылка на заказ-наряд (ремонт, G1–G9). Тоже новая: в legacy работы лежали
    // в отдельной таблице `doc.work_order_labor`.
    //
    // Отдельная таблица не нужна, потому что строка работы — это ТА ЖЕ строка:
    // у неё уже есть `service_type_id` (вид услуги) и `norm_hours` (нормо-часы)
    // из карты §4.2. Работа отличается от товара значениями этих полей, а не формой.
    workOrderId: uuid('work_order_id'),
    operation: text('operation').$type<'sale' | 'purchase'>(),
    nomenclatureId: uuid('nomenclature_id'),
    quantity: numeric('quantity', { precision: 10, scale: 2 }),
    supplierId: uuid('supplier_id'),
    batchId: uuid('batch_id'),
    status: text('status'),
    deleted: boolean('deleted').notNull().default(false),
    salePrice: numeric('sale_price', { precision: 15, scale: 2 }),
    contractId: uuid('contract_id'),
    customerId: uuid('customer_id'),
    comment: text('comment'),
    orderDate: timestamp('order_date'),
    internalOrderNumber: text('internal_order_number'),
    serviceTypeId: uuid('service_type_id'),
    urgency: text('urgency'),
    territory: text('territory'),
    costPrice: numeric('cost_price', { precision: 15, scale: 2 }),
    signedOriginal: boolean('signed_original'),
    normHours: numeric('norm_hours', { precision: 15, scale: 2 }),
    rrc: numeric('rrc', { precision: 15, scale: 2 }),
    comment2: text('comment2'),

    // --- служебное (входит в L) ---
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    warehouseId: uuid('warehouse_id'),
    cellId: uuid('cell_id'),
    selfPickup: boolean('self_pickup').notNull().default(false),
    zoneId: uuid('zone_id'),
    deletedById: uuid('deleted_by_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    extraFlag: boolean('extra_flag').notNull().default(false),
  },
  (t) => [
    index('line_status_idx').on(t.status),
    index('line_customer_order_idx').on(t.customerOrderId),
    index('line_supplier_order_idx').on(t.supplierOrderId),
    index('line_nomenclature_idx').on(t.nomenclatureId),
    // If-Match: уникальность пары (id, version) делает конфликт версий дешёвым.
    index('line_id_version_idx').on(t.id, t.version),
  ],
);

// Данные заявки «как написал клиент» — 6 столбцов, вынесены из строки.
// Связь 1:1: `id` здесь и есть `line.id` (PK = FK), поэтому таблица занимает
// 7 столбцов, а не 8 — см. примечание к §4.3 задания.
export const lineFact = pgTable('line_fact', {
  id: uuid('id')
    .primaryKey()
    .references(() => line.id, { onDelete: 'cascade' }),
  clientOrderNumber: text('client_order_number'),
  factName: text('fact_name'),
  factQty: text('fact_qty'),
  vehiclePlate: text('vehicle_plate'),
  factArticle: text('fact_article'),
  factUnit: text('fact_unit'),
});

// Состояние сессии: отметка строки — не данные строки, а действие пользователя.
// Тоже 1:1: `id` = `line.id`.
export const lineMark = pgTable('line_mark', {
  id: uuid('id')
    .primaryKey()
    .references(() => line.id, { onDelete: 'cascade' }),
  marked: boolean('marked').notNull().default(false),
  markedById: uuid('marked_by_id'),
});
