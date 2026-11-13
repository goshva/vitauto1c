import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Правка, закрытие и удаление заказа покупателя (3 операции).
// Вынесено из `orders.ts`: файл вышел 299 строк при лимите 200.

export const ordersEdit = createApi();

// --- PATCH /orders/{id} — правка шапки ------------------------------------------------

/** Поля шапки, которые правит оператор. Остальное — вычисляемое или служебное. */
const EDITABLE: Record<string, string> = {
  ship_date: 'ship_date',
  client_order_number: 'client_order_number',
  contract_id: 'contract_id',
  counterparty_id: 'counterparty_id',
};

ordersEdit.openapi(createRoute({
  method: 'patch',
  path: '/orders/{id}',
  tags: ['orders'],
  summary: 'Изменить поле шапки заказа (If-Match: версия)',
  request: {
    params: z.object({ id: uuid }),
    headers: z.object({ 'if-match': z.string().optional() }),
    body: { content: { 'application/json': { schema: z.object({
      field: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }) } } },
  },
  responses: {
    200: { description: 'Заказ изменён', content: { 'application/json': { schema: z.object({
      version: z.number(),
    }) } } },
    400: { description: 'Поле не редактируется' },
    404: { description: 'Заказ не найден' },
    409: { description: 'Конфликт версий' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const { field, value } = c.req.valid('json');
  const ifMatch = c.req.valid('header')['if-match'];

  const column = EDITABLE[field];
  if (!column) {
    const allowed = Object.keys(EDITABLE).join(', ');
    return problemResponse(c, new Problem(400, 'field_readonly',
      `Поле «${field}» не редактируется вручную. Редактируемые: ${allowed}`, field));
  }

  const current = await pool.query<{ version: string }>(
    `select version::text from customer_order where id = $1 and deleted_at is null`, [id],
  );
  if (current.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Заказ ${id} не найден`));
  }

  const version = Number(current.rows[0]!.version);
  if (ifMatch !== undefined && Number.isFinite(Number(ifMatch)) && Number(ifMatch) !== version) {
    return problemResponse(c, new Problem(409, 'version_conflict',
      `Заказ изменили: ожидалась версия ${ifMatch}, в базе ${version}`));
  }

  const r = await pool.query(
    `update customer_order set ${column} = $2, version = version + 1, updated_at = now()
      where id = $1 returning version::text`,
    [id, value],
  );
  return c.json({ version: Number(r.rows[0]!.version) }, 200);
});

// --- POST /orders/{id}/close ----------------------------------------------------------

ordersEdit.openapi(createRoute({
  method: 'post',
  path: '/orders/{id}/close',
  tags: ['orders'],
  summary: 'Закрыть заказ: все строки в «Закрыт»',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Заказ закрыт', content: { 'application/json': { schema: z.object({
      id: uuid, closed: z.number().int(), skipped: z.array(z.string()),
    }) } } },
    404: { description: 'Заказ не найден' },
    409: { description: 'Нет строк или все уже закрыты' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const lines = await pool.query<{ id: string; status: string }>(
    `select id, status from line where customer_order_id = $1 and not deleted order by id`, [id],
  );
  if (lines.rowCount === 0) {
    return problemResponse(c, new Problem(409, 'nothing_marked',
      'В заказе нет строк: закрывать нечего.'));
  }

  const open = lines.rows.filter((l) => l.status !== 'closed');
  if (open.length === 0) {
    return problemResponse(c, new Problem(409, 'already_closed', 'Все строки заказа уже закрыты.'));
  }

  // Закрываем только строки в состояниях, из которых закрытие разрешено переходом.
  // Остальные перечисляем — оператор должен видеть, что осталось.
  const closable = ['shipped', 'ready_to_ship', 'return', 'assembly'];
  const toClose = open.filter((l) => closable.includes(l.status));
  const skipped = open
    .filter((l) => !closable.includes(l.status))
    .map((l) => `${l.id}: из статуса «${l.status}» закрытие недоступно`);

  if (toClose.length > 0) {
    await pool.query(
      `update line set status = 'closed', version = version + 1, updated_at = now()
        where id = any($1::uuid[])`,
      [toClose.map((l) => l.id)],
    );
  }

  return c.json({ id, closed: toClose.length, skipped }, 200);
});

// --- DELETE /orders/{id} — мягкое удаление --------------------------------------------

ordersEdit.openapi(createRoute({
  method: 'delete',
  path: '/orders/{id}',
  tags: ['orders'],
  summary: 'Удалить заказ вместе со строками (мягко)',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Заказ удалён', content: { 'application/json': { schema: z.object({
      id: uuid, lines: z.number().int(),
    }) } } },
    404: { description: 'Заказ не найден' },
    409: { description: 'Есть отгруженные строки — удалять нельзя' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const exists = await pool.query(`select 1 from customer_order where id = $1 and deleted_at is null`, [id]);
  if (exists.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Заказ ${id} не найден`));
  }

  // Отгруженный товар у клиента: удаление заказа не вернёт его на склад,
  // и остаток перестанет сходиться с документами.
  const shipped = await pool.query(
    `select count(*)::text as n from line
      where customer_order_id = $1 and not deleted and status in ('shipped', 'closed')`,
    [id],
  );
  if (Number(shipped.rows[0]!.n) > 0) {
    return problemResponse(c, new Problem(409, 'bad_transition',
      'В заказе есть отгруженные строки: удаление не вернёт товар на склад. ' +
      'Оформите возврат, затем удаляйте.'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const lines = await client.query(
      `update line set deleted = true, deleted_at = now(), version = version + 1
        where customer_order_id = $1 and not deleted`,
      [id],
    );
    await client.query(
      `update customer_order set deleted_at = now(), version = version + 1 where id = $1`, [id],
    );
    await client.query('commit');
    return c.json({ id, lines: lines.rowCount ?? 0 }, 200);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
