import { boolean, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Склад и партии. Вынесено из `ref.ts` (200 строк и 5 экспортов на файл).

const stamp = () => ({
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const warehouse = pgTable('warehouse', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code'),
  name: text('name').notNull(),
  organizationId: uuid('organization_id'),
  isWarehouse: boolean('is_warehouse').notNull().default(true),
  isMain: boolean('is_main').notNull().default(false),
  ...stamp(),
});

// Зоны склада: ровно те, что перечислены в форме резерва АРМ
// (приёмка, малый и большой склад, неопознанные и возвраты, ремонтная зона,
// укомплектованные).
export const warehouseZone = pgTable(
  'warehouse_zone',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code'),
    name: text('name').notNull(),
    purpose: text('purpose'),
    sort: integer('sort').notNull().default(0),
    ...stamp(),
  },
  (t) => [index('warehouse_zone_code_idx').on(t.code)],
);

export const storageCell = pgTable(
  'storage_cell',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id'),
    zoneId: uuid('zone_id'),
    code: text('code'),
    capacity: numeric('capacity', { precision: 15, scale: 2 }),
    blocked: boolean('blocked').notNull().default(false),
    ...stamp(),
  },
  (t) => [index('storage_cell_zone_idx').on(t.zoneId)],
);

export const batch = pgTable(
  'batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code'),
    name: text('name').notNull(),
    batchNo: text('batch_no'),
    supplierId: uuid('supplier_id'),
    status: text('status'),
    expiresAt: timestamp('expires_at'),
    inactive: boolean('inactive').notNull().default(false),
    ...stamp(),
  },
  (t) => [index('batch_supplier_idx').on(t.supplierId)],
);
