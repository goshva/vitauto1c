import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';

// Канбан снабжения (M7, P2). Вынесен из `operations.ts`: файл перевалил за 200 строк.
//
// В legacy эти статусы менялись через 1С, и без публикации 1С шаг было не пройти —
// отсюда пункты в manual.md, которые «нельзя покрыть, потому что нужны данные».
//
// Целевой статус строки и допустимые исходные лежат ОДНОЙ таблицей: разнести их
// по двум местам — значит однажды получить кнопку, которая ничего не делает.

export const supply = createApi();

interface SupplyRule {
  /** Статус строки, в который переводит канбан. */
  to: string;
  /** Из каких статусов строки это допустимо. */
  from: string[];
}

const SUPPLY_RULES: Record<string, SupplyRule> = {
  paid: { to: 'paid', from: ['ordered'] },
  in_transit: { to: 'in_transit', from: ['paid'] },
  acceptance: { to: 'acceptance', from: ['in_transit'] },
  to_stock: { to: 'to_stock', from: ['acceptance'] },
  assembly: { to: 'assembly', from: ['to_stock', 'reserve'] },
  assembled: { to: 'ready_to_ship', from: ['assembly'] },
};

const SupplyBody = z.object({
  status: z.enum(['paid', 'in_transit', 'acceptance', 'to_stock', 'assembly', 'assembled']),
});

const supplyRoute = createRoute({
  method: 'post',
  path: '/supply/status',
  tags: ['supply'],
  summary: 'Статус снабжения по отмеченным строкам (M7, P2)',
  request: { body: { content: { 'application/json': { schema: SupplyBody } } } },
  responses: {
    200: { description: 'Итог', content: { 'application/json': { schema: z.object({
      processed: z.number(), total: z.number(), skipped: z.array(z.string()),
    }) } } },
    409: { description: 'Нет отмеченных строк' },
  },
});

interface MarkedLine { id: string; status: string; name: string }

supply.openapi(supplyRoute, async (c) => {
  const { status } = c.req.valid('json');
  const rule = SUPPLY_RULES[status]!;

  const marked = await pool.query<MarkedLine>(
    `select l.id, l.status, coalesce(f.fact_name, l.id::text) as name
       from line l
       join line_mark m on m.id = l.id and m.marked
       left join line_fact f on f.id = l.id
      where not l.deleted
      order by l.order_date, l.id`,
  );

  if (marked.rowCount === 0) {
    return problemResponse(c, new Problem(409, 'nothing_marked',
      'Нет отмеченных строк. Отметьте строки в списке снабжения и повторите.'));
  }

  const skipped: string[] = [];
  let processed = 0;
  for (const line of marked.rows) {
    if (!rule.from.includes(line.status)) {
      skipped.push(`${line.name}: статус «${line.status}» не переходит в «${status}»`);
      continue;
    }
    await pool.query(
      `update line set status = $2, version = version + 1, updated_at = now() where id = $1`,
      [line.id, rule.to],
    );
    await pool.query(`update line_mark set marked = false where id = $1`, [line.id]);
    processed++;
  }

  return c.json({ processed, total: marked.rowCount!, skipped }, 200);
});
