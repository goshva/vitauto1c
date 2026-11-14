import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse, ProblemSchema } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { SELECT, toItem, type InvoiceRow } from './invoices-query.ts';

// Счёт: список и выставление (2 операции). Оплата — в `invoices-flow.ts`.
//
// Заказчик (Q6) запросил МИНИМУМ — статус оплаты, а не бухгалтерию. Без него
// нельзя закрыть заказ поставщику и нельзя показать «сколько заработали».
// Ни платёжных поручений, ни выписок, ни НДС здесь нет и не будет.

export const invoices = createApi();

const InvoiceSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  date: z.string(),
  status: z.string(),
  statusTitle: z.string(),
  kind: z.string(),
  amount: z.string().nullable(),
  counterparty: z.string().nullable(),
  comment: z.string().nullable(),
  paidAt: z.string().nullable(),
  canPay: z.boolean().describe('Счёт отправлен и ждёт оплаты'),
});

export { InvoiceSchema };

// --- GET /invoices -------------------------------------------------------------------

invoices.openapi(createRoute({
  method: 'get',
  path: '/invoices',
  tags: ['invoice'],
  summary: 'Счета со статусом оплаты',
  request: { query: z.object({
    status: z.enum(['draft', 'sent', 'paid']).optional(),
    kind: z.enum(['incoming', 'outgoing']).optional(),
  }) },
  responses: {
    200: { description: 'Список счетов', content: { 'application/json': { schema: z.object({
      items: z.array(InvoiceSchema), total: z.number().int(),
      unpaidTotal: z.string().describe('Сумма неоплаченных — «сколько ещё не пришло»'),
    }) } } },
  },
}), async (c) => {
  const q = c.req.valid('query');
  const parts: string[] = [];
  const params: unknown[] = [];
  if (q.status) { params.push(q.status); parts.push(`i.status = $${params.length}`); }
  if (q.kind) { params.push(q.kind); parts.push(`i.kind = $${params.length}`); }

  const r = await pool.query<InvoiceRow>(
    `${SELECT}
      where i.deleted_at is null ${parts.length ? `and ${parts.join(' and ')}` : ''}
      order by i.date desc, i.number desc`,
    params,
  );
  // «Сколько ещё не пришло» — по всем неоплаченным, а не только по показанным:
  // иначе фильтр по статусу менял бы смысл итога.
  const unpaid = await pool.query<{ t: string }>(
    `select coalesce(sum(amount), 0)::text t from invoice
      where deleted_at is null and status <> 'paid'`,
  );

  return c.json({
    items: r.rows.map(toItem) as never[],
    total: r.rowCount ?? 0,
    unpaidTotal: unpaid.rows[0]!.t,
  }, 200);
});

// --- POST /invoices — выставить ------------------------------------------------------

invoices.openapi(createRoute({
  method: 'post',
  path: '/invoices',
  tags: ['invoice'],
  summary: 'Выставить счёт: по заказу или вручную',
  request: { body: { content: { 'application/json': { schema: z.object({
    /** Счёт по заказу: сумма и контрагент берутся из него. */
    customerOrderId: uuid.optional(),
    supplierOrderId: uuid.optional(),
    kind: z.enum(['incoming', 'outgoing']).optional(),
    amount: z.string().optional(),
    counterpartyId: uuid.optional(),
    comment: z.string().optional(),
  }) } } } },
  responses: {
    201: { description: 'Счёт выставлен', content: { 'application/json': { schema: InvoiceSchema } } },
    400: { description: 'Не указана сумма и нет заказа', content: { 'application/json': { schema: ProblemSchema } } },
    404: { description: 'Заказ не найден', content: { 'application/json': { schema: ProblemSchema } } },
  },
}), async (c) => {
  const body = c.req.valid('json');

  let amount = body.amount ?? null;
  let counterpartyId = body.counterpartyId ?? null;
  const kind = body.kind ?? (body.supplierOrderId ? 'incoming' : 'outgoing');

  if (body.customerOrderId) {
    const o = await pool.query<{ total: string | null; counterparty_id: string | null }>(
      `select total::text, counterparty_id from customer_order
        where id = $1 and deleted_at is null`,
      [body.customerOrderId],
    );
    if (o.rowCount === 0) {
      return problemResponse(c, new Problem(404, 'not_found', `Заказ ${body.customerOrderId} не найден`));
    }
    // Сумма по умолчанию — из заказа: счёт «по заказу» с другой суммой почти
    // всегда означает, что оператор забыл её заполнить.
    amount ??= o.rows[0]!.total;
    counterpartyId ??= o.rows[0]!.counterparty_id;
  }

  if (amount === null) {
    return problemResponse(c, new Problem(400, 'bad_request',
      'Нечего выставлять: укажите сумму или заказ, из которого её взять.', 'amount'));
  }

  const seq = await pool.query<{ n: string }>(`select (count(*) + 1)::text n from invoice`);
  const number = `СЧ-${seq.rows[0]!.n.padStart(4, '0')}`;

  const r = await pool.query<InvoiceRow>(
    `insert into invoice (number, status, kind, counterparty_id, customer_order_id,
                          supplier_order_id, amount, comment)
     values ($1, 'draft', $2, $3, $4, $5, $6, $7)
     returning id, number, date, status, kind, amount::text, comment, paid_at,
               (select name from counterparty where id = $3) as counterparty`,
    [number, kind, counterpartyId, body.customerOrderId ?? null,
      body.supplierOrderId ?? null, amount, body.comment ?? null],
  );

  return c.json(toItem(r.rows[0]!) as never, 201);
});
