import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Склад: остатки и движения (2 операции).
//
// Остаток НЕ хранится в строке — он вычисляется из движений представлением
// `stock_balance`. Поэтому ручное движение доступно, а «правка остатка» — нет:
// правка остатка напрямую разошлась бы с движениями, и никто не смог бы объяснить,
// откуда взялось число.

export const stock = createApi();

const MOVE_KINDS = ['receipt', 'expense', 'reserve', 'unreserve', 'shipment', 'return'] as const;

// --- GET /stock/balance ---------------------------------------------------------------

const BalanceQuery = z.object({
  nomenclatureId: uuid.optional(),
  warehouseId: uuid.optional(),
  onlyPositive: z.enum(['true', 'false']).optional().describe('Только ненулевой остаток'),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

stock.openapi(createRoute({
  method: 'get',
  path: '/stock/balance',
  tags: ['warehouse'],
  summary: 'Остатки по номенклатуре и местам хранения',
  request: { query: BalanceQuery },
  responses: {
    200: { description: 'Остатки', content: { 'application/json': { schema: z.object({
      items: z.array(z.object({
        nomenclature_id: z.string(),
        nomenclature: z.string().nullable(),
        article: z.string().nullable(),
        warehouse_id: z.string().nullable(),
        warehouse: z.string().nullable(),
        cell_id: z.string().nullable(),
        cell: z.string().nullable(),
        batch_id: z.string().nullable(),
        on_hand: z.string(),
        reserved: z.string(),
        available: z.string().describe('Свободный остаток: on_hand − reserved'),
      })),
      total: z.number().int(),
    }) } } },
    400: { description: 'Некорректный фильтр' },
  },
}), async (c) => {
  const { nomenclatureId, warehouseId, onlyPositive, limit } = c.req.valid('query');
  const params: unknown[] = [];
  let where = 'where 1 = 1';

  if (nomenclatureId) { params.push(nomenclatureId); where += ` and sb.nomenclature_id = $${params.length}`; }
  if (warehouseId) { params.push(warehouseId); where += ` and sb.warehouse_id = $${params.length}`; }
  if (onlyPositive === 'true') where += ' and (sb.on_hand <> 0 or sb.reserved <> 0)';

  params.push(limit);
  const r = await pool.query(
    `select sb.nomenclature_id, n.name as nomenclature, n.article,
            sb.warehouse_id, w.name as warehouse,
            sb.cell_id, c.code as cell,
            sb.batch_id,
            sb.on_hand::text, sb.reserved::text,
            (sb.on_hand - sb.reserved)::text as available
       from stock_balance sb
       left join nomenclature n on n.id = sb.nomenclature_id
       left join warehouse w on w.id = sb.warehouse_id
       left join storage_cell c on c.id = sb.cell_id
       ${where}
      order by n.name, c.code
      limit $${params.length}`,
    params,
  );
  return c.json({ items: r.rows as never[], total: r.rowCount ?? 0 }, 200);
});

// --- POST /stock/moves — ручное движение ---------------------------------------------

stock.openapi(createRoute({
  method: 'post',
  path: '/stock/moves',
  tags: ['warehouse'],
  summary: 'Провести движение по складу (инвентаризация, списание)',
  request: { body: { content: { 'application/json': { schema: z.object({
    nomenclatureId: uuid,
    warehouseId: uuid,
    cellId: uuid.optional(),
    batchId: uuid.optional(),
    kind: z.enum(MOVE_KINDS),
    quantity: z.string().describe('Количество; для расхода укажите положительное число'),
    comment: z.string().optional(),
  }) } } } },
  responses: {
    201: { description: 'Движение создано', content: { 'application/json': { schema: z.object({
      moveId: uuid, onHand: z.string(),
    }) } } },
    400: { description: 'Номенклатура не найдена или количество не число' },
  },
}), async (c) => {
  const body = c.req.valid('json');

  const qty = Number(body.quantity.replace(',', '.'));
  if (!Number.isFinite(qty) || qty <= 0) {
    return problemResponse(c, new Problem(400, 'bad_request',
      `Количество «${body.quantity}» не является положительным числом`, 'quantity'));
  }

  const nom = await pool.query(`select 1 from nomenclature where id = $1 and deleted_at is null`,
    [body.nomenclatureId]);
  if (nom.rowCount === 0) {
    return problemResponse(c, new Problem(400, 'bad_request',
      `Номенклатура ${body.nomenclatureId} не найдена`, 'nomenclatureId'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    const move = await client.query<{ id: string }>(
      `insert into stock_move (nomenclature_id, warehouse_id, cell_id, batch_id, kind, quantity, comment)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [body.nomenclatureId, body.warehouseId, body.cellId ?? null, body.batchId ?? null,
        body.kind, qty, body.comment ?? null],
    );

    // Остаток читаем из представления сразу после движения: оператор должен видеть,
    // что получилось, а не искать это в другом экране.
    const balance = await client.query<{ on_hand: string }>(
      `select coalesce(on_hand, 0)::text as on_hand from stock_balance
        where nomenclature_id = $1
          and warehouse_id is not distinct from $2
          and cell_id is not distinct from $3
          and batch_id is not distinct from $4`,
      [body.nomenclatureId, body.warehouseId, body.cellId ?? null, body.batchId ?? null],    );

    await client.query('commit');
    return c.json({ moveId: move.rows[0]!.id, onHand: balance.rows[0]?.on_hand ?? '0' }, 201);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
