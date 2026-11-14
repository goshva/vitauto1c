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
// Виды движения: receipt (приход), expense (ручной расход), write_off (списание
// на ремонт), reserve (резерв), unreserve (снятие резерва), shipment (отгрузка),
// return (возврат).
//
// `write_off` отделён от `expense` намеренно (Q4): ручной расход и списание по
// заказ-наряду — разные события. Первое делают «просто так» (бой, недостача),
// второе связывают с ремонтом, и по нему считается расход на конкретное ТС.
// Один вид на оба случая не дал бы ответить «сколько ушло на ремонт машины № 42».

export const stockMove = pgTable(
  'stock_move',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nomenclatureId: uuid('nomenclature_id').notNull(),
    warehouseId: uuid('warehouse_id'),
    cellId: uuid('cell_id'),
    batchId: uuid('batch_id'),
    lineId: uuid('line_id'),
    /**
     * Заказ-наряд, ради которого сделано движение (Q4).
     *
     * У `line` уже есть `work_order_id`, и связь можно было бы получить через неё —
     * но тогда «запчасти, зарезервированные под наряд» и «списанное по наряду»
     * пришлось бы каждый раз собирать соединением, а резерв, не привязанный к
     * строке, терялся бы вовсе. Прямая ссылка делает связь явной.
     */
    workOrderId: uuid('work_order_id'),
    kind: text('kind')
      .$type<'receipt' | 'expense' | 'write_off' | 'reserve' | 'unreserve' | 'shipment' | 'return'>()
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
    index('stock_move_work_order_idx').on(t.workOrderId),
  ],
);
