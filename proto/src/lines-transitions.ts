import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { STATUSES } from './domain/status.ts';
import { checkTransition, requiresSignedOriginal } from './domain/transition.ts';
import { uuid } from './domain/uuid.ts';
import { loadLine } from './lines-fields.ts';

// Переход процесса и отметка строки. Вынесено из `lines-mutations.ts` (было 211 строк).
//
// Переход применяется к ОТМЕЧЕННЫМ строкам и по каждой пропущенной сообщает причину.
// В legacy строка попадала в `skipped` без причины, и оператор видел
// «Обработано 0 из 1», не понимая, что делать (C21).

export const transitions = createApi();

const TransitionBody = z.object({
  to: z.string().min(1),
});

const transitionRoute = createRoute({
  method: 'post',
  path: '/lines/transition',
  tags: ['lines'],
  summary: 'Переход процесса по отмеченным строкам',
  request: { body: { content: { 'application/json': { schema: TransitionBody } } } },
  responses: {
    200: { description: 'Итог обработки', content: { 'application/json': { schema: z.object({
      processed: z.number(), total: z.number(), skipped: z.array(z.string()),
    }) } } },
    400: { description: 'Неизвестный переход' },
    409: { description: 'Нет отмеченных строк' },
  },
});

transitions.openapi(transitionRoute, async (c) => {
  const { to } = c.req.valid('json');

  if (!STATUSES.includes(to as (typeof STATUSES)[number])) {
    return problemResponse(c, new Problem(400, 'bad_request',
      `Неизвестный статус «${to}». Допустимые: ${STATUSES.join(', ')}`, 'to'));
  }

  const marked = await pool.query<{ id: string; status: string; signed_original: boolean; name: string }>(
    `select l.id, l.status, coalesce(l.signed_original, false) as signed_original,
            coalesce(f.fact_name, l.id::text) as name
       from line l
       join line_mark m on m.id = l.id and m.marked
       left join line_fact f on f.id = l.id
      where not l.deleted
      order by l.order_date, l.id
      for update of l`,
  );

  if (marked.rowCount === 0) {
    return problemResponse(c, new Problem(409, 'nothing_marked',
      'Нет отмеченных строк. Отметьте строки в списке и повторите.'));
  }

  const skipped: string[] = [];
  let processed = 0;

  for (const line of marked.rows) {
    const denial = checkTransition(to, line.status);
    if (denial) {
      // Конкретная причина вместо молчаливого пропуска (C21).
      skipped.push(`${line.name}: ${denial}`);
      continue;
    }
    if (requiresSignedOriginal(to, line.status) && !line.signed_original) {
      skipped.push(`${line.name}: не отмечено «Документ подписан оригинал»`);
      continue;
    }
    await pool.query(
      `update line set status = $2, version = version + 1, updated_at = now() where id = $1`,
      [line.id, to],
    );
    await pool.query(`update line_mark set marked = false where id = $1`, [line.id]);
    processed++;
  }

  return c.json({ processed, total: marked.rowCount!, skipped }, 200);
});

const markRoute = createRoute({
  method: 'post',
  path: '/lines/{id}/mark',
  tags: ['lines'],
  summary: 'Отметить или снять отметку',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({ marked: z.boolean() }) } } },
  },  responses: {
    200: { description: 'Отметка применена', content: { 'application/json': { schema: z.object({
      marked: z.boolean(), markedCount: z.number(),
    }) } } },
    404: { description: 'Строка не найдена' },
  },
});

transitions.openapi(markRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { marked } = c.req.valid('json');

  await loadLine(id); // 404, если строки нет

  await pool.query(
    `insert into line_mark (id, marked, marked_by_id) values ($1, $2, null)
     on conflict (id) do update set marked = excluded.marked`,
    [id, marked],
  );

  const n = await pool.query<{ n: string }>(`select count(*)::text as n from line_mark where marked`);
  return c.json({ marked, markedCount: Number(n.rows[0]!.n) }, 200);
});
