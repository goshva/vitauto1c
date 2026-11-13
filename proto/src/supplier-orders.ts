import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { SUPPLIER_ORDER_STATUSES } from './domain/supplier-order-state.ts';

// Заказ поставщику: список, карточка, создание (3 операции).
//
// Закупка идёт от строк в статусе «Новый» или «В работе»: задание (M4) переводит
// их в «Заказан», но документ заказа поставщику создаётся отдельно — чтобы
// поставщик и срок поставки были видны оператору.
//
// Подтверждение, отмена и получение — в `supplier-orders-flow.ts`.

export const supplierOrders = createApi();

/** Статусы строк, из которых создаётся заказ поставщику. */
const ORDERABLE = ['new', 'in_work', 'ordered'];

// --- GET /supplier-orders -------------------------------------------------------------

const ListQuery = z.object({
  status: z.enum(SUPPLIER_ORDER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

supplierOrders.openapi(createRoute({
  method: 'get',
  path: '/supplier-orders',
  tags: ['purchase'],
  summary: 'Список заказов поставщику',
  request: { query: ListQuery },
  responses: {
    200: { description: 'Заказы', content: { 'application/json': { schema: z.object({
      items: z.array(z.record(z.string(), z.unknown())), total: z.number().int(),
    }) } } },
    400: { description: 'Неизвестное состояние' },
  },
}), async (c) => {
  const { status, limit } = c.req.valid('query');
  const params: unknown[] = [];
  let where = 'where s.deleted_at is null';

  if (status) { params.push(status); where += ` and s.status = $${params.length}`; }
  params.push(limit);

  const r = await pool.query(
    `select s.id, s.number, s.date, s.status, s.counterparty_id, s.customer_order_id,
            s.receipt_date, s.total, s.version, cp.name as supplier,
            (select count(*) from line l where l.supplier_order_id = s.id and not l.deleted) as lines
       from supplier_order s
       left join counterparty cp on cp.id = s.counterparty_id
       ${where} order by s.date desc, s.number limit $${params.length}`,
    params,
  );
  return c.json({ items: r.rows as never[], total: r.rowCount ?? 0 }, 200);
});

// --- GET /supplier-orders/{id} --------------------------------------------------------

supplierOrders.openapi(createRoute({
  method: 'get',
  path: '/supplier-orders/{id}',
  tags: ['purchase'],
  summary: 'Заказ поставщику со строками',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Заказ и его строки', content: { 'application/json': { schema: z.object({
      header: z.record(z.string(), z.unknown()),
      lines: z.array(z.record(z.string(), z.unknown())),
    }) } } },
    404: { description: 'Заказ не найден' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const head = await pool.query(
    `select s.id, s.number, s.date, s.status, s.counterparty_id, s.customer_order_id,
            s.receipt_date, s.total, s.version, cp.name as supplier
       from supplier_order s left join counterparty cp on cp.id = s.counterparty_id
      where s.id = $1 and s.deleted_at is null`,
    [id],
  );
  if (head.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Заказ поставщику ${id} не найден`));
  }

  const lines = await pool.query(
    `select l.id, l.status, l.quantity, l.nomenclature_id, l.supplier_id,
            n.name as nomenclature, n.article, f.fact_name
       from line l
       left join nomenclature n on n.id = l.nomenclature_id
       left join line_fact f on f.id = l.id
      where l.supplier_order_id = $1 and not l.deleted
      order by l.id`,
    [id],
  );
  return c.json({ header: head.rows[0] as never, lines: lines.rows as never[] }, 200);
});

// --- POST /supplier-orders — создание заказа ------------------------------------------

supplierOrders.openapi(createRoute({
  method: 'post',
  path: '/supplier-orders',
  tags: ['purchase'],
  summary: 'Создать заказ поставщику по отмеченным строкам',
  request: { body: { content: { 'application/json': { schema: z.object({
    supplierId: uuid.optional().describe('Если не указан — берётся из строки'),
    receiptDate: z.string().optional().describe('Ожидаемая дата поступления'),
  }) } } } },
  responses: {
    201: { description: 'Заказ создан', content: { 'application/json': { schema: z.object({
      id: uuid, number: z.string(), lines: z.number().int(), skipped: z.array(z.string()),
    }) } } },
    409: { description: 'Нет отмеченных строк, годных к закупке' },
  },
}), async (c) => {
  const { supplierId, receiptDate } = c.req.valid('json');

  const marked = await pool.query<{ id: string; status: string; supplier_id: string | null; name: string }>(
    `select l.id, l.status, l.supplier_id, coalesce(f.fact_name, l.id::text) as name
       from line l join line_mark m on m.id = l.id and m.marked
       left join line_fact f on f.id = l.id
      where not l.deleted and l.supplier_order_id is null
      order by l.order_date, l.id`,
  );

  const ready = marked.rows.filter((l) => ORDERABLE.includes(l.status));
  if (ready.length === 0) {
    const why = marked.rowCount === 0
      ? 'Нет отмеченных строк.'
      : `Отмеченные строки не годны к закупке (статусы: ${[...new Set(marked.rows.map((l) => l.status))].join(', ')}).`;
    return problemResponse(c, new Problem(409, 'nothing_marked',
      `${why} К закупке годны: ${ORDERABLE.join(', ')}.`));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    const seq = await client.query<{ n: string }>(
      `select (coalesce(max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::bigint), 0) + 1)::text as n
         from supplier_order where number like 'ЗП-%'`,
    );
    const number = `ЗП-${String(seq.rows[0]!.n).padStart(4, '0')}`;

    const head = await client.query<{ id: string }>(
      `insert into supplier_order (number, status, operation, counterparty_id, customer_order_id,
                                   organization_id, receipt_date)
       values ($1, 'new', 'purchase', $2,
               (select customer_order_id from line where id = $3),
               '55555555-5555-5555-5555-555555555501', $4)
       returning id`,
      [number, supplierId ?? ready[0]!.supplier_id, ready[0]!.id, receiptDate ?? null],
    );
    const orderId = head.rows[0]!.id;

    for (const line of ready) {
      // Статус не меняем: задание (M4) уже перевело строки в «Заказан».
      // Заказ поставщику фиксирует КОМУ и КОГДА — это отдельный факт.
      await client.query(
        `update line set supplier_order_id = $2, version = version + 1, updated_at = now()
          where id = $1`,
        [line.id, orderId],
      );
      await client.query(`update line_mark set marked = false where id = $1`, [line.id]);
    }

    await client.query('commit');
    const skipped = marked.rows.filter((l) => !ORDERABLE.includes(l.status))
      .map((l) => `${l.name}: из статуса «${l.status}» заказ поставщику не создаётся`);
    return c.json({ id: orderId, number, lines: ready.length, skipped }, 201);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
