import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Отказ клиента (ФТ v2 п. 15) — отдельный модуль, и не только по размеру.
//
// Решение заказчика (14.11.2026): «Отменён»/«Отказался» — это состояние ЗАКАЗА.
// Клиент отказывается от заказа ЦЕЛИКОМ, и это событие другого рода, чем правка
// документа: оно не меняет ни одной строки заказа, а фиксирует сам факт отказа.
//
// Вынесено из `orders-edit.ts` ещё и потому, что тот перешёл предел 200 строк из
// §12 задания — архитектурный гейт поймал это сам.

export const ordersRefusal = createApi();

// --- POST /orders/{id}/refuse — отказ клиента (ФТ v2 п. 15) --------------------------
//
// Решение заказчика (14.11.2026): «Отменён»/«Отказался» — это состояние ЗАКАЗА.
// Клиент отказывается от заказа ЦЕЛИКОМ, а не от отдельной позиции, и одно событие
// на шапке честнее десятка состояний на строках.
//
// Состояния строк при этом НЕ переписываются: строка остаётся там, где её застал
// отказ, и склад видит, докуда дошёл товар. Иначе «отгружен» превратилось бы в
// «отменён», и вопрос «где железо» остался бы без ответа.

const REFUSAL_STATES = ['cancelled', 'refused'] as const;

ordersRefusal.openapi(createRoute({
  method: 'post',
  path: '/orders/{id}/refuse',
  tags: ['orders'],
  summary: 'Отказ клиента: состояние ЗАКАЗА (ФТ v2 п. 15)',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({
      to: z.enum(REFUSAL_STATES).describe('cancelled — до выдачи, refused — при получении'),
      reason: z.string().optional().describe('Причина отказа со слов клиента'),
    }) } } },
  },
  responses: {
    200: { description: 'Отказ зафиксирован', content: { 'application/json': { schema: z.object({
      id: uuid, status: z.string(), lines: z.number().int(),
      /** Строки, которые уже уехали: их состояние не переписываем. */
      shipped: z.number().int(),
    }) } } },
    400: { description: 'Недопустимое состояние отказа' },
    404: { description: 'Заказ не найден' },
    409: { description: 'Заказ уже закрыт или уже отменён' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const { to, reason } = c.req.valid('json');

  const order = await pool.query<{ status: string }>(
    `select status from customer_order where id = $1 and deleted_at is null`, [id]);
  if (order.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Заказ ${id} не найден`));
  }

  const current = order.rows[0]!.status;
  if (current === 'closed') {
    return problemResponse(c, new Problem(409, 'already_closed',
      'Заказ закрыт: отказ по нему уже не оформить.'));
  }
  if (REFUSAL_STATES.includes(current as 'cancelled')) {
    return problemResponse(c, new Problem(409, 'already_refused',
      `Заказ уже в состоянии отказа («${current}»).`));
  }

  const lines = await pool.query<{ n: string }>(
    `select count(*)::text n from line where customer_order_id = $1 and not deleted`, [id]);
  const shipped = await pool.query<{ n: string }>(
    `select count(*)::text n from line
      where customer_order_id = $1 and not deleted and status in ('shipped', 'closed')`, [id]);

  await pool.query(
    `update customer_order
        set status = $2, refused_at = now(), refusal_reason = $3,
            version = version + 1, updated_at = now()
      where id = $1`,
    [id, to, reason ?? null],
  );

  return c.json({
    id,
    status: to,
    lines: Number(lines.rows[0]!.n),
    shipped: Number(shipped.rows[0]!.n),
  }, 200);
});
