import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';
import { Problem, problemResponse, ProblemSchema } from './problem.ts';
import { STATUSES } from './domain/status.ts';
import { uuid } from './domain/uuid.ts';

// Чтение строк. Источник — представление `line_view` (48 колонок), а не таблица:
// список АРМ показывает данные документа и справочников, которых в строке нет.
//
// Фильтр по статусу ОБЯЗАН отвечать 400 на неизвестный статус. В legacy `?status=`
// принимал не все коды и МОЛЧА игнорировался: запрос `?status=reserve` возвращал весь
// список (154 строки вместо 3) — из-за этого тесты делали ложные выводы (C18).

export const LineRowSchema = z
  .object({
    id: z.string().uuid(),
    marked: z.boolean(),
    status: z.string(),
    quantity: z.string().nullable(),
    salePrice: z.string().nullable(),
    saleSum: z.string().nullable(),
    costPrice: z.string().nullable(),
    costSum: z.string().nullable(),
    stockQty: z.string(),
    reserveQty: z.string(),
    inTransitQty: z.string(),
    nomenclature: z.string().nullable(),
    nomenclatureArticle: z.string().nullable(),
    customer: z.string().nullable(),
    supplier: z.string().nullable(),
    contract: z.string().nullable(),
    batch: z.string().nullable(),
    stockCell: z.string().nullable(),
    factName: z.string().nullable(),
    factQty: z.string().nullable(),
    factArticle: z.string().nullable(),
    clientOrderNumber: z.string().nullable(),
    shipmentNumber: z.string().nullable(),
    orderDate: z.string().nullable(),
    comment: z.string().nullable(),
  })
  .passthrough()
  .openapi('LineRow');

const ListQuery = z.object({
  view: z.enum(['sales', 'purchases']).optional().default('sales'),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  cursor: z.coerce.number().int().min(0).optional().default(0),
});

export const lines = createApi();

const listRoute = createRoute({
  method: 'get',
  path: '/lines',
  tags: ['lines'],
  summary: 'Список строк',
  request: { query: ListQuery },
  responses: {
    200: {
      description: 'Строки и курсор продолжения',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(LineRowSchema),
            nextCursor: z.number().int().nullable(),
            total: z.number().int(),
          }),
        },
      },
    },
    400: {
      description: 'Неизвестный статус в фильтре',
      content: { 'application/json': { schema: ProblemSchema } },
    },
  },
});

lines.openapi(listRoute, async (c) => {
  const { view, status, limit, cursor } = c.req.valid('query');

  if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
    return problemResponse(
      c,
      new Problem(400, 'bad_request',
        `Неизвестный статус «${status}». Допустимые: ${STATUSES.join(', ')}`, 'status'),
    );
  }

  const params: unknown[] = [view === 'sales' ? 'sale' : 'purchase'];
  let where = 'where operation = $1';
  if (status) {
    params.push(status);
    where += ` and status = $${params.length}`;
  }

  const total = await pool.query<{ n: string }>(
    `select count(*)::text as n from line_view ${where}`,
    params,
  );

  params.push(limit, cursor);
  const rows = await pool.query(
    `select * from line_view ${where} order by "order" limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  const next = cursor + rows.rowCount! < Number(total.rows[0]!.n) ? cursor + rows.rowCount! : null;
  return c.json({ items: rows.rows as never[], nextCursor: next, total: Number(total.rows[0]!.n) }, 200);
});

const getRoute = createRoute({
  method: 'get',
  path: '/lines/{id}',
  tags: ['lines'],
  summary: 'Строка по идентификатору',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Строка', content: { 'application/json': { schema: LineRowSchema } } },
    404: { description: 'Не найдена', content: { 'application/json': { schema: ProblemSchema } } },
  },
});

lines.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');
  // Тип строки берём из схемы ответа: `as never` у одиночного объекта не проходит
  // проверку типов Hono — объединение с ошибкой вырождается, и маршрут не компилируется.
  const r = await pool.query<z.infer<typeof LineRowSchema>>(
    `select * from line_view where "id" = $1`, [id],
  );
  if (r.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }
  return c.json(r.rows[0]!, 200);
});
