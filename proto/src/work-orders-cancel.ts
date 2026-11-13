import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { loadOrProblem } from './work-orders-flow.ts';

// Отмена заказ-наряда. Вынесено из `work-orders-flow.ts`: файл перевалил за лимит
// в 200 строк. Отмена — отдельная забота: она не МЕНЯЕТ состояние наряда,
// а убирает его вместе со строками.

export const workOrdersCancel = createApi();

// --- DELETE /work-orders/{id} — отмена наряда ----------------------------------------

workOrdersCancel.openapi(createRoute({
  method: 'delete',
  path: '/work-orders/{id}',
  tags: ['repair'],
  summary: 'Отменить заказ-наряд (мягкое удаление)',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Наряд отменён', content: { 'application/json': { schema: z.object({
      id: uuid, released: z.number().int(),
    }) } } },
    404: { description: 'Заказ-наряд не найден' },
    409: { description: 'Закрытый наряд отменить нельзя' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const loaded = await loadOrProblem(id);
  if ('problem' in loaded) return problemResponse(c, loaded.problem);

  if (loaded.head!.status === 'closed') {
    return problemResponse(c, new Problem(409, 'bad_transition',
      'Закрытый заказ-наряд отменить нельзя: работы предъявлены клиенту.'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    // Строки наряда уходят вместе с ним: работы и запчасти без наряда — мусор,
    // который оператор не увидит и не уберёт.
    const lines = await client.query(
      `update line set deleted = true, deleted_at = now(), version = version + 1
        where work_order_id = $1 and not deleted`,
      [id],
    );
    await client.query(
      `update work_order set deleted_at = now(), version = version + 1 where id = $1`,
      [id],
    );
    await client.query('commit');
    return c.json({ id, released: lines.rowCount ?? 0 }, 200);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
