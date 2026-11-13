import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import {
  RETURN_STATUSES,
  RETURN_STATES,
  checkReturnTransition,
} from './domain/return-state.ts';

type ReturnStatus = (typeof RETURN_STATUSES)[number];

// Движение возврата: принять на склад (K6), передать поставщику (M16), закрыть (P3).
// Вынесено из `returns.ts`: файл перевалил за 300 строк при лимите 200.
//
// Строки возврата переходят ВМЕСТЕ с документом. Иначе товар «застревает» в статусе
// возврата при закрытом документе — расхождение, которое находят на складе, а не в тесте.

export const returnsFlow = createApi();

interface ReturnHead {
  id: string;
  number: string | null;
  status: string;
}

/** Возврат по идентификатору, либо 404. */
export async function loadReturn(id: string): Promise<ReturnHead> {
  const r = await pool.query<ReturnHead>(
    `select id, number, status from return_order where id = $1 and deleted_at is null`,
    [id],
  );
  if (r.rowCount === 0) throw new Problem(404, 'not_found', `Возврат ${id} не найден`);
  return r.rows[0]!;
}

/** Переход состояния: общий обработчик для трёх операций. */
function addTransition(path: string, to: ReturnStatus, title: string, summary: string): void {
  returnsFlow.openapi(createRoute({
    method: 'post',
    path,
    tags: ['returns'],
    summary: title,
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: { description: 'Состояние изменено', content: { 'application/json': { schema: z.object({
        id: uuid, status: z.string(), lines: z.number().int(),
      }) } } },
      404: { description: 'Возврат не найден' },
      409: { description: 'Недопустимый переход' },
    },
  }), async (c) => {
    const { id } = c.req.valid('param');

    let head: ReturnHead;
    try {
      head = await loadReturn(id);
    } catch (e) {
      if (e instanceof Problem) return problemResponse(c, e);
      throw e;
    }

    const denial = checkReturnTransition(head.status, to);
    if (denial) return problemResponse(c, new Problem(409, 'bad_transition', `${summary}: ${denial}`));

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update return_order set status = $2, version = version + 1, updated_at = now() where id = $1`,
        [id, to],
      );
      const lines = await client.query(
        `update line set status = $2, version = version + 1, updated_at = now()
          where return_id = $1 and not deleted`,
        [id, RETURN_STATES[to].lineStatus],
      );
      await client.query('commit');
      return c.json({ id, status: to, lines: lines.rowCount ?? 0 }, 200);
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  });
}

addTransition('/returns/{id}/accept', 'accepted', 'Принять возврат на склад (K6)',
  'Приём возврата на склад');
addTransition('/returns/{id}/supplier', 'to_supplier', 'Передать возврат поставщику (M16)',
  'Передача возврата поставщику');
addTransition('/returns/{id}/close', 'closed', 'Закрыть возврат (P3)',
  'Закрытие возврата');

// --- DELETE /returns/{id} — отмена оформленного возврата -----------------------------

returnsFlow.openapi(createRoute({
  method: 'delete',
  path: '/returns/{id}',
  tags: ['returns'],
  summary: 'Отменить возврат (мягкое удаление)',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Возврат отменён', content: { 'application/json': { schema: z.object({
      id: uuid, released: z.number().int(),
    }) } } },
    404: { description: 'Возврат не найден' },
    409: { description: 'Закрытый возврат отменить нельзя' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  let head: ReturnHead;
  try {
    head = await loadReturn(id);
  } catch (e) {
    if (e instanceof Problem) return problemResponse(c, e);
    throw e;
  }

  if (head.status === 'closed') {
    return problemResponse(c, new Problem(409, 'bad_transition',
      'Закрытый возврат отменить нельзя: товар уже принят или отгружен поставщику.'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    // Строки возвращаются в «Отгружен»: товар физически у клиента, и это
    // единственный статус, из которого возврат оформляют заново (N3).
    const lines = await client.query(
      `update line set return_id = null, status = 'shipped', version = version + 1, updated_at = now()
        where return_id = $1 and not deleted`,
      [id],
    );
    await client.query(
      `update return_order set deleted_at = now(), version = version + 1 where id = $1`,
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
