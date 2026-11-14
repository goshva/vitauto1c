import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse, ProblemSchema } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { checkInvoiceTransition, INVOICE_STATES } from './domain/invoice-state.ts';
import { SELECT, toItem, type InvoiceRow } from './invoices-query.ts';
import { InvoiceSchema } from './invoices.ts';

// Оплата счёта: черновик → отправлен → оплачен (1 операция).
//
// Вынесено из `invoices.ts`: список и выставление — чтение и создание, а здесь
// ДРУГОЕ поведение (проверка перехода, отказы, дата оплаты), и вместе файл
// перевалил за 200 строк.

export const invoicesFlow = createApi();

invoicesFlow.openapi(createRoute({
  method: 'post',
  path: '/invoices/{id}/transition',
  tags: ['invoice'],
  summary: 'Перевести счёт: черновик → отправлен → оплачен',
  request: {
    params: z.object({ id: uuid }),
    // Строка, а не enum: проверку ведёт домен, и его отказ ПЕРЕЧИСЛЯЕТ допустимые
    // состояния. С `z.enum` ответ пришёл бы от валидатора, без списка, и оператор
    // не понял бы, что делать.
    body: { content: { 'application/json': { schema: z.object({ to: z.string() }) } } },
  },
  responses: {
    200: { description: 'Состояние изменено', content: { 'application/json': { schema: InvoiceSchema } } },
    400: { description: 'Неизвестное состояние', content: { 'application/json': { schema: ProblemSchema } } },
    404: { description: 'Счёт не найден', content: { 'application/json': { schema: ProblemSchema } } },
    409: { description: 'Недопустимый переход', content: { 'application/json': { schema: ProblemSchema } } },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const { to } = c.req.valid('json');

  const current = await pool.query<{ status: string }>(
    `select status from invoice where id = $1 and deleted_at is null`, [id],
  );
  if (current.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Счёт ${id} не найден`));
  }
  const from = current.rows[0]!.status;

  // Неизвестное состояние — ошибка ввода (400), недопустимый переход — конфликт (409).
  // Разные коды важны: первое исправляет оператор, второе — состояние документа.
  if (!(to in INVOICE_STATES)) {
    return problemResponse(c, new Problem(400, 'bad_request', checkInvoiceTransition(from, to)!, 'to'));
  }
  const denial = checkInvoiceTransition(from, to);
  if (denial) {
    return problemResponse(c, new Problem(409, 'bad_transition', denial, 'to'));
  }

  // Дата оплаты ставится ровно на переходе в `paid`: по ней считается
  // «сколько денег пришло в этом месяце».
  await pool.query(
    `update invoice set status = $2,
                        paid_at = case when $2 = 'paid' then now() else paid_at end,
                        version = version + 1, updated_at = now()
      where id = $1`,
    [id, to],
  );

  const fresh = await pool.query<InvoiceRow>(`${SELECT} where i.id = $1`, [id]);
  return c.json(toItem(fresh.rows[0]!) as never, 200);
});
