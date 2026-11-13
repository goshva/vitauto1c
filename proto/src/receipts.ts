import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Приёмка: список, карточка, создание (3 операции).
//
// Путь K1 → M12 → K2: принять товар по УПД, провести по складу, разместить в ячейку.
// Отдельного состояния документа не вводим: у приёмки уже есть `posted` — черновик
// или проведена. Третье состояние («размещено») выражается статусами СТРОК, а не
// документом: размещение идёт по строкам, у каждой своя ячейка.
//
// Проведение и отмена — в `receipts-flow.ts`.

export const receipts = createApi();

/**
 * Статусы, из которых строку можно принять.
 *
 * `ordered`, `in_transit` — закупка: товар едет от поставщика.
 * `acceptance` — приёмка уже начата канбаном снабжения (K1).
 */
const RECEIVABLE = ['ordered', 'in_transit', 'acceptance'];

// --- GET /receipts -------------------------------------------------------------------

const ListQuery = z.object({
  posted: z.enum(['true', 'false']).optional().describe('Проведённые или черновики'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

receipts.openapi(createRoute({
  method: 'get',
  path: '/receipts',
  tags: ['warehouse'],
  summary: 'Список приёмок',
  request: { query: ListQuery },
  responses: {
    200: { description: 'Приёмки', content: { 'application/json': { schema: z.object({
      items: z.array(z.record(z.string(), z.unknown())), total: z.number().int(),
    }) } } },
    400: { description: 'Некорректный фильтр' },
  },
}), async (c) => {
  const { posted, limit } = c.req.valid('query');
  const params: unknown[] = [];
  let where = 'where r.deleted_at is null';

  if (posted) { params.push(posted === 'true'); where += ` and r.posted = $${params.length}`; }
  params.push(limit);

  const r = await pool.query(
    `select r.id, r.number, r.date, r.posted, r.counterparty_id, r.warehouse_id, r.total, r.version,
            cp.name as supplier,
            (select count(*) from line l where l.receipt_id = r.id and not l.deleted) as lines
       from receipt r
       left join counterparty cp on cp.id = r.counterparty_id
       ${where} order by r.date desc, r.number limit $${params.length}`,
    params,
  );
  return c.json({ items: r.rows as never[], total: r.rowCount ?? 0 }, 200);
});

// --- GET /receipts/{id} ---------------------------------------------------------------

receipts.openapi(createRoute({
  method: 'get',
  path: '/receipts/{id}',
  tags: ['warehouse'],
  summary: 'Приёмка со строками',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Приёмка и её строки', content: { 'application/json': { schema: z.object({
      header: z.record(z.string(), z.unknown()),
      lines: z.array(z.record(z.string(), z.unknown())),
      canPost: z.boolean().describe('Можно ли провести'),
    }) } } },
    404: { description: 'Приёмка не найдена' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const head = await pool.query(
    `select r.id, r.number, r.date, r.posted, r.counterparty_id, r.warehouse_id, r.total, r.version,
            cp.name as supplier
       from receipt r left join counterparty cp on cp.id = r.counterparty_id
      where r.id = $1 and r.deleted_at is null`,
    [id],
  );
  if (head.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Приёмка ${id} не найдена`));
  }

  const lines = await pool.query(
    `select l.id, l.status, l.quantity, l.nomenclature_id, l.cell_id,
            n.name as nomenclature, n.article,
            (select code from storage_cell c where c.id = l.cell_id) as cell
       from line l
       left join nomenclature n on n.id = l.nomenclature_id
      where l.receipt_id = $1 and not l.deleted
      order by l.id`,
    [id],
  );

  const header = head.rows[0] as { posted: boolean };
  return c.json({
    header: header as never,
    lines: lines.rows as never[],
    canPost: !header.posted && (lines.rowCount ?? 0) > 0,
  }, 200);
});

// --- POST /receipts — создание по отмеченным строкам (K1) ----------------------------

receipts.openapi(createRoute({
  method: 'post',
  path: '/receipts',
  tags: ['warehouse'],
  summary: 'Создать приёмку по отмеченным строкам (K1)',
  request: { body: { content: { 'application/json': { schema: z.object({
    comment: z.string().optional(),
  }) } } } },
  responses: {
    201: { description: 'Приёмка создана', content: { 'application/json': { schema: z.object({
      id: uuid, number: z.string(), lines: z.number().int(), skipped: z.array(z.string()),
    }) } } },
    409: { description: 'Нет отмеченных строк, готовых к приёмке' },
  },
}), async (c) => {
  const marked = await pool.query<{ id: string; status: string; supplier_id: string | null; name: string }>(
    `select l.id, l.status, l.supplier_id,
            coalesce(f.fact_name, l.id::text) as name
       from line l join line_mark m on m.id = l.id and m.marked
       left join line_fact f on f.id = l.id
      where not l.deleted and l.receipt_id is null
      order by l.order_date, l.id`,
  );

  const ready = marked.rows.filter((l) => RECEIVABLE.includes(l.status));
  if (ready.length === 0) {
    const why = marked.rowCount === 0
      ? 'Нет отмеченных строк.'
      : `Отмеченные строки не готовы к приёмке (статусы: ${[...new Set(marked.rows.map((l) => l.status))].join(', ')}).`;
    return problemResponse(c, new Problem(409, 'nothing_marked',
      `${why} К приёмке годны: ${RECEIVABLE.join(', ')}.`));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    const seq = await client.query<{ n: string }>(
      `select (coalesce(max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::bigint), 0) + 1)::text as n
         from receipt where number like 'ПР-%'`,
    );
    const number = `ПР-${String(seq.rows[0]!.n).padStart(4, '0')}`;

    const head = await client.query<{ id: string }>(
      `insert into receipt (number, operation, counterparty_id, warehouse_id, posted)
       values ($1, 'purchase',
               (select supplier_id from line where id = $2),
               '44444444-4444-4444-4444-444444444401', false)
       returning id`,
      [number, ready[0]!.id],
    );
    const receiptId = head.rows[0]!.id;

    for (const line of ready) {
      // Статус не меняем: товар ещё не принят. Проведение — отдельная операция.
      await client.query(
        `update line set receipt_id = $2, version = version + 1, updated_at = now() where id = $1`,
        [line.id, receiptId],
      );
      await client.query(`update line_mark set marked = false where id = $1`, [line.id]);
    }

    await client.query('commit');
    const skipped = marked.rows.filter((l) => !RECEIVABLE.includes(l.status))
      .map((l) => `${l.name}: из статуса «${l.status}» приёмка не создаётся`);
    return c.json({ id: receiptId, number, lines: ready.length, skipped }, 201);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
