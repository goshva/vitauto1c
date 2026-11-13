import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Жизненный цикл строки: удаление, восстановление, массовое удаление (3 операции).
// Вынесено из `lines-bulk.ts`: файл вышел 272 строки при лимите 200.

export const linesLifecycle = createApi();

/**
 * Статусы, из которых строку можно удалить: товар ещё не ушёл к клиенту.
 *
 * Тот же список, что в `lines-bulk.ts`. Дублирование намеренное: файлы не должны
 * зависеть друг от друга ради одной константы, а расхождение поймает тест
 * «удаление отгруженной строки запрещено».
 */
const DELETABLE = ['new', 'in_work', 'ordered', 'partially_ordered', 'cancelled'];

// --- DELETE /lines/{id} и восстановление ---------------------------------------------

linesLifecycle.openapi(createRoute({
  method: 'delete',
  path: '/lines/{id}',
  tags: ['lines'],
  summary: 'Удалить строку (мягко)',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Строка удалена', content: { 'application/json': { schema: z.object({
      id: uuid,
    }) } } },
    404: { description: 'Строка не найдена' },
    409: { description: 'Отгруженную строку удалять нельзя' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const line = await pool.query<{ status: string }>(
    `select status from line where id = $1 and not deleted`, [id],
  );
  if (line.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }

  const status = line.rows[0]!.status;
  if (!DELETABLE.includes(status)) {
    return problemResponse(c, new Problem(409, 'bad_transition',
      `Строку в статусе «${status}» удалять нельзя: товар уже в работе или у клиента. ` +
      `Удалять можно из: ${DELETABLE.join(', ')}.`));
  }

  await pool.query(
    `update line set deleted = true, deleted_at = now(), version = version + 1 where id = $1`,
    [id],
  );
  return c.json({ id }, 200);
});

linesLifecycle.openapi(createRoute({
  method: 'post',
  path: '/lines/{id}/restore',
  tags: ['lines'],
  summary: 'Восстановить удалённую строку',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Строка восстановлена', content: { 'application/json': { schema: z.object({
      id: uuid, status: z.string(),
    }) } } },
    404: { description: 'Удалённая строка не найдена' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const r = await pool.query<{ status: string }>(
    `update line set deleted = false, deleted_at = null, version = version + 1, updated_at = now()
      where id = $1 and deleted
      returning status`,
    [id],
  );
  if (r.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found',
      `Удалённая строка ${id} не найдена (возможно, она не удалена).`));
  }
  return c.json({ id, status: r.rows[0]!.status }, 200);
});

// --- POST /lines/bulk-delete — удаление отмеченных ------------------------------------

linesLifecycle.openapi(createRoute({
  method: 'post',
  path: '/lines/bulk-delete',
  tags: ['lines'],
  summary: 'Удалить отмеченные строки',
  request: {},
  responses: {
    200: { description: 'Итог', content: { 'application/json': { schema: z.object({
      deleted: z.number().int(), skipped: z.array(z.string()),
    }) } } },
    409: { description: 'Нет отмеченных строк' },
  },
}), async (c) => {
  const marked = await pool.query<{ id: string; status: string }>(
    `select l.id, l.status from line l
       join line_mark m on m.id = l.id and m.marked
      where not l.deleted order by l.id`,
  );

  if (marked.rowCount === 0) {
    return problemResponse(c, new Problem(409, 'nothing_marked',
      'Нет отмеченных строк. Отметьте строки в списке и повторите.'));
  }

  const deletable = marked.rows.filter((l) => DELETABLE.includes(l.status));
  const skipped = marked.rows
    .filter((l) => !DELETABLE.includes(l.status))
    .map((l) => `${l.id}: из статуса «${l.status}» удаление недоступно`);

  if (deletable.length > 0) {
    await pool.query(
      `update line set deleted = true, deleted_at = now(), version = version + 1
        where id = any($1::uuid[])`,
      [deletable.map((l) => l.id)],
    );
    await pool.query(`update line_mark set marked = false where id = any($1::uuid[])`,
      [deletable.map((l) => l.id)]);
  }

  return c.json({ deleted: deletable.length, skipped }, 200);
});

