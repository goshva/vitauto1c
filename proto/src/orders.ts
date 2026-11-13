import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Заказы покупателя: список и карточка (2 операции).
// Правка, закрытие и удаление — в `orders-edit.ts`.
//
// У заказа НЕТ собственного состояния: оно выводится из строк. Заказ — это папка
// для строк, и его «статус» всегда «самая отстающая строка». Отдельное поле статуса
// пришлось бы синхронизировать со строками, и оно неизбежно разошлось бы с ними.
//
// Закрытие заказа закрывает строки: это единственная операция, где заказ
// воздействует на них.

export const orders = createApi();

// --- GET /orders ----------------------------------------------------------------------

const ListQuery = z.object({
  operation: z.enum(['sale', 'purchase']).optional().default('sale'),
  clientOrderNumber: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

orders.openapi(createRoute({
  method: 'get',
  path: '/orders',
  tags: ['orders'],
  summary: 'Список заказов покупателя',
  request: { query: ListQuery },
  responses: {
    200: { description: 'Заказы', content: { 'application/json': { schema: z.object({
      items: z.array(z.record(z.string(), z.unknown())), total: z.number().int(),
    }) } } },
    400: { description: 'Некорректный фильтр' },
  },
}), async (c) => {
  const { operation, clientOrderNumber, limit } = c.req.valid('query');
  const params: unknown[] = [operation];
  let where = 'where o.deleted_at is null and o.operation = $1';

  if (clientOrderNumber) {
    params.push(`%${clientOrderNumber.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    where += ` and o.client_order_number ilike $${params.length}`;
  }
  params.push(limit);

  const r = await pool.query(
    `select o.id, o.number, o.date, o.client_order_number, o.counterparty_id,
            o.ship_date, o.total, o.version, cp.name as customer,
            (select count(*) from line l where l.customer_order_id = o.id and not l.deleted) as lines,
            (select count(*) from line l where l.customer_order_id = o.id and not l.deleted
               and l.status = 'closed') as closed_lines,
            (select min(l.status) from line l where l.customer_order_id = o.id and not l.deleted) as first_status
       from customer_order o
       left join counterparty cp on cp.id = o.counterparty_id
       ${where} order by o.date desc, o.number limit $${params.length}`,
    params,
  );
  return c.json({ items: r.rows as never[], total: r.rowCount ?? 0 }, 200);
});

// --- GET /orders/{id} -----------------------------------------------------------------

orders.openapi(createRoute({
  method: 'get',
  path: '/orders/{id}',
  tags: ['orders'],
  summary: 'Заказ со строками',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Заказ и его строки', content: { 'application/json': { schema: z.object({
      header: z.record(z.string(), z.unknown()),
      lines: z.array(z.record(z.string(), z.unknown())),
      summary: z.record(z.string(), z.unknown()).describe('Свод по строкам'),
      canClose: z.boolean().describe('Все ли строки в конечном состоянии'),
    }) } } },
    404: { description: 'Заказ не найден' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const head = await pool.query(
    `select o.id, o.number, o.date, o.client_order_number, o.counterparty_id, o.contract_id,
            o.organization_id, o.ship_date, o.total, o.version, cp.name as customer
       from customer_order o left join counterparty cp on cp.id = o.counterparty_id
      where o.id = $1 and o.deleted_at is null`,
    [id],
  );
  if (head.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Заказ ${id} не найден`));
  }

  const lines = await pool.query(
    `select l.id, l.status, l.quantity, l.nomenclature_id, l.cell_id,
            n.name as nomenclature, f.fact_name, f.fact_qty,
            coalesce(l.quantity, 0) * coalesce(l.sale_price, 0) as sale_sum
       from line l
       left join nomenclature n on n.id = l.nomenclature_id
       left join line_fact f on f.id = l.id
      where l.customer_order_id = $1 and not l.deleted
      order by l.order_date, l.id`,
    [id],
  );

  // Свод считается на сервере: если считать на клиенте, экран заказа и список
  // строк начнут показывать разные суммы.
  const summary = await pool.query<{ status: string; n: string; qty: string; sum: string }>(
    `select status, count(*)::text as n,
            coalesce(sum(quantity), 0)::text as qty,
            coalesce(sum(coalesce(quantity, 0) * coalesce(sale_price, 0)), 0)::text as sum
       from line where customer_order_id = $1 and not deleted
      group by status order by status`,
    [id],
  );

  const rows = lines.rows as { status: string }[];
  // Закрывать есть смысл, только если есть что закрывать.
  const canClose = rows.length > 0 && rows.some((l) => l.status !== 'closed');

  return c.json({
    header: head.rows[0] as never,
    lines: lines.rows as never[],
    summary: { byStatus: summary.rows, lines: rows.length } as never,
    canClose,
  }, 200);
});
