import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { RETURN_KINDS, RETURN_STATUSES } from './domain/return-state.ts';

// Возвраты: список, карточка и оформление (3 операции).
//
// Три процесса, которые в legacy были ОДНОЙ формой с разными кнопками, а в модели —
// тремя сценариями:
//   client   — «Возврат от клиента» (N3 → K6 → M19 → M16 → K6 → P3)
//   supplier — «Возврат поставщику (от менеджера)» (M16)
//   internal — «Отказ клиента при получении товара» (N2a)
//
// Движение возврата (принять, передать поставщику, закрыть, отменить) — в
// `returns-flow.ts`: файл обязан держать ≤ 200 строк.

export const returns = createApi();

// --- GET /returns --------------------------------------------------------------------

const ListQuery = z.object({
  kind: z.enum(RETURN_KINDS).optional().describe('client / supplier / internal'),
  status: z.enum(RETURN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

returns.openapi(createRoute({
  method: 'get',
  path: '/returns',
  tags: ['returns'],
  summary: 'Список возвратов',
  request: { query: ListQuery },
  responses: {
    200: { description: 'Возвраты', content: { 'application/json': { schema: z.object({
      items: z.array(z.record(z.string(), z.unknown())),
      total: z.number().int(),
    }) } } },
    400: { description: 'Неизвестный вид или состояние' },
  },
}), async (c) => {
  const { kind, status, limit } = c.req.valid('query');
  const params: unknown[] = [];
  let where = 'where deleted_at is null';

  if (kind) { params.push(kind); where += ` and kind = $${params.length}`; }
  if (status) { params.push(status); where += ` and status = $${params.length}`; }

  params.push(limit);
  const r = await pool.query(
    `select id, number, date, kind, status, counterparty_id, total, version
       from return_order ${where} order by date desc, number limit $${params.length}`,
    params,
  );
  return c.json({ items: r.rows as never[], total: r.rowCount ?? 0 }, 200);
});

// --- GET /returns/{id} — возврат вместе со строками ----------------------------------

returns.openapi(createRoute({
  method: 'get',
  path: '/returns/{id}',
  tags: ['returns'],
  summary: 'Возврат со строками',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Возврат и его строки', content: { 'application/json': { schema: z.object({
      header: z.record(z.string(), z.unknown()),
      lines: z.array(z.record(z.string(), z.unknown())),
    }) } } },
    404: { description: 'Возврат не найден' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const head = await pool.query(
    `select id, number, date, kind, status, counterparty_id, total, version
       from return_order where id = $1 and deleted_at is null`,
    [id],
  );
  if (head.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Возврат ${id} не найден`));
  }

  const lines = await pool.query(
    `select l.id, l.status, l.quantity, l.nomenclature_id, f.fact_name
       from line l left join line_fact f on f.id = l.id
      where l.return_id = $1 and not l.deleted
      order by l.id`,
    [id],
  );
  return c.json({ header: head.rows[0] as never, lines: lines.rows as never[] }, 200);
});

// --- POST /returns — оформление по отмеченным строкам (N3) ---------------------------

returns.openapi(createRoute({
  method: 'post',
  path: '/returns',
  tags: ['returns'],
  summary: 'Оформить возврат по отмеченным строкам (N3)',
  request: { body: { content: { 'application/json': { schema: z.object({
    kind: z.enum(RETURN_KINDS)
      .describe('client — от клиента, supplier — поставщику, internal — отказ при получении'),
    comment: z.string().optional(),
  }) } } } },
  responses: {
    201: { description: 'Возврат оформлен', content: { 'application/json': { schema: z.object({
      id: uuid, number: z.string(), lines: z.number().int(),
    }) } } },
    409: { description: 'Нет отмеченных строк для возврата' },
  },
}), async (c) => {
  const { kind } = c.req.valid('json');

  const marked = await pool.query<{ id: string; counterparty_id: string | null }>(
    `select l.id, l.customer_id as counterparty_id
       from line l join line_mark m on m.id = l.id and m.marked
      where not l.deleted and l.return_id is null
      order by l.order_date, l.id`,
  );

  if (marked.rowCount === 0) {
    return problemResponse(c, new Problem(409, 'nothing_marked',
      'Нет отмеченных строк для возврата. Отметьте строки в списке и повторите.'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    const seq = await client.query<{ n: string }>(
      `select (coalesce(max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::bigint), 0) + 1)::text as n
         from return_order where number like 'ВЗ-%'`,
    );
    const number = `ВЗ-${String(seq.rows[0]!.n).padStart(4, '0')}`;

    const head = await client.query<{ id: string }>(
      `insert into return_order (number, kind, status, operation, counterparty_id, warehouse_id)
       values ($1, $2, 'new', 'sale', $3, '44444444-4444-4444-4444-444444444401')
       returning id`,
      [number, kind, marked.rows[0]!.counterparty_id],
    );
    const returnId = head.rows[0]!.id;

    for (const line of marked.rows) {
      await client.query(
        `update line set return_id = $2, status = 'return', version = version + 1, updated_at = now()
          where id = $1`,
        [line.id, returnId],
      );
      await client.query(`update line_mark set marked = false where id = $1`, [line.id]);
    }

    await client.query('commit');
    return c.json({ id: returnId, number, lines: marked.rowCount! }, 201);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
