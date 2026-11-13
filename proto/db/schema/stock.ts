import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Движения по складу — ИСТОЧНИК остатков. В legacy было `stock.move` (37 столбцов)
// и представление `stock.balance` поверх него; в строке же лежали денормализованные
// `stock_qty`, `reserve_qty`, `in_transit_qty`, `stock_total_qty` (столбцы 20, 23, 58, 59).
//
// В прототипе остаток не хранится в строке: он вычисляется из движений. Поэтому
// `line` не содержит ни одного из четырёх столбцов остатка — они ушли в представление
// `stock_balance` (метка V карты §4.2).
//
// Виды движения: receipt (приход), expense (расход), reserve (резерв),
// unreserve (снятие резерва), shipment (отгрузка), return (возврат).

export const stockMove = pgTable(
  'stock_move',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nomenclatureId: uuid('nomenclature_id').notNull(),
    warehouseId: uuid('warehouse_id'),
    cellId: uuid('cell_id'),
    batchId: uuid('batch_id'),
    lineId: uuid('line_id'),
    kind: text('kind')
      .$type<'receipt' | 'expense' | 'reserve' | 'unreserve' | 'shipment' | 'return'>()
      .notNull(),
    quantity: numeric('quantity', { precision: 15, scale: 3 }).notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stock_move_nomenclature_idx').on(t.nomenclatureId),
    index('stock_move_line_idx').on(t.lineId),
    index('stock_move_kind_idx').on(t.kind),
    index('stock_move_place_idx').on(t.warehouseId, t.cellId, t.batchId),
  ],
);
