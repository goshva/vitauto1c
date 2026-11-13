import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';

// Строки: свод, массовые операции, удаление и экспорт (6 операций).
//
// Массовые операции работают по ОТМЕЧЕННЫМ строкам — так же, как переходы.
// Отдельного «выделить всё» нет намеренно: оператор должен видеть, что отмечает
// (в legacy «выделить всё» на 154 строках приводило к массовым ошибкам).
//
// Монтируется ДО \`lines.ts\`: иначе \`GET /lines/{id}\` перехватил бы \`/lines/summary\`
// и ответил бы 400 на не-UUID.

export const linesBulk = createApi();

// --- GET /lines/summary — свод по статусам -------------------------------------------

const SummaryQuery = z.object({
  view: z.enum(['sales', 'purchases']).optional().default('sales'),
});

linesBulk.openapi(createRoute({
  method: 'get',
  path: '/lines/summary',
  tags: ['lines'],
  summary: 'Свод по статусам: сколько строк, количество и суммы',
  request: { query: SummaryQuery },
  responses: {
    200: { description: 'Свод', content: { 'application/json': { schema: z.object({
      byStatus: z.array(z.object({
        status: z.string(), lines: z.number().int(),
        quantity: z.string(), saleSum: z.string(),
      })),
      total: z.object({ lines: z.number().int(), quantity: z.string(), saleSum: z.string() }),
    }) } } },
  },
}), async (c) => {
  const { view } = c.req.valid('query');
  const operation = view === 'sales' ? 'sale' : 'purchase';

  const r = await pool.query<{ status: string; lines: string; quantity: string; sale_sum: string }>(
    `select status,
            count(*)::text as lines,
            coalesce(sum(quantity), 0)::text as quantity,
            coalesce(sum(coalesce(quantity, 0) * coalesce(sale_price, 0)), 0)::text as sale_sum
       from line where not deleted and operation = $1
      group by status order by status`,
    [operation],
  );

  const byStatus = r.rows.map((x) => ({
    status: x.status,
    lines: Number(x.lines),
    quantity: x.quantity,
    saleSum: x.sale_sum,
  }));

  return c.json({
    byStatus,
    total: {
      lines: byStatus.reduce((a, b) => a + b.lines, 0),
      quantity: String(byStatus.reduce((a, b) => a + Number(b.quantity), 0)),
      saleSum: byStatus.reduce((a, b) => a + Number(b.saleSum), 0).toFixed(2),
    },
  }, 200);
});

// --- POST /lines/bulk-field — массовая правка поля -----------------------------------

/** Поля, которые можно править массово. Список тот же, что у одиночной правки. */
const BULK_EDITABLE = ['comment', 'comment2', 'urgency', 'territory', 'warehouse_id', 'zone_id'];

linesBulk.openapi(createRoute({
  method: 'post',
  path: '/lines/bulk-field',
  tags: ['lines'],
  summary: 'Проставить поле у отмеченных строк',
  request: { body: { content: { 'application/json': { schema: z.object({
    field: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }) } } } },
  responses: {
    200: { description: 'Итог', content: { 'application/json': { schema: z.object({
      updated: z.number().int(),
    }) } } },
    400: { description: 'Поле не редактируется массово' },
    409: { description: 'Нет отмеченных строк' },
  },
}), async (c) => {
  const { field, value } = c.req.valid('json');

  if (!BULK_EDITABLE.includes(field)) {
    return problemResponse(c, new Problem(400, 'field_readonly',
      `Поле «${field}» не правится массово. Доступные: ${BULK_EDITABLE.join(', ')}`, field));
  }

  const r = await pool.query(
    `update line set ${field} = $1, version = version + 1, updated_at = now()
      where id in (select id from line_mark where marked) and not deleted`,
    [value],
  );

  if (r.rowCount === 0) {
    return problemResponse(c, new Problem(409, 'nothing_marked',
      'Нет отмеченных строк. Отметьте строки в списке и повторите.'));
  }

  // Отметки снимаются: иначе следующее массовое действие затронет те же строки
  // незаметно для оператора.
  await pool.query(
    `update line_mark set marked = false where id in (select id from line where not deleted)`,
  );

  return c.json({ updated: r.rowCount ?? 0 }, 200);
});

// --- GET /lines/export — выгрузка CSV -------------------------------------------------

linesBulk.openapi(createRoute({
  method: 'get',
  path: '/lines/export',
  tags: ['lines'],
  summary: 'Выгрузить строки в CSV',
  request: { query: z.object({ view: z.enum(['sales', 'purchases']).optional().default('sales') }) },
  responses: {
    200: { description: 'CSV', content: { 'text/csv': { schema: z.string() } } },
  },
}), async (c) => {
  const { view } = c.req.valid('query');
  const r = await pool.query(
    `select "order", "status", "clientOrderNumber", "factName", "nomenclature",
            "quantity", "salePrice", "saleSum", "customer", "comment"
       from line_view where operation = $1 order by "order"`,
    [view === 'sales' ? 'sale' : 'purchase'],
  );

  // Разделитель — точка с запятой, кодировка с BOM: иначе Excel в русской
  // локали складывает весь файл в одну колонку и ломает кириллицу.
  const headers = Object.keys(r.rows[0] ?? { order: '', status: '' });
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(';'),
    ...r.rows.map((row) => headers.map((h) => escape((row as Record<string, unknown>)[h])).join(';')),
  ].join('\r\n');

  return c.body(`\uFEFF${csv}`, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="lines.csv"',
  });
});
