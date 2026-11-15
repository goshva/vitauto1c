import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';
import { Problem, problemResponse, ProblemSchema } from './problem.ts';
import { STATUSES } from './domain/status.ts';
import { uuid } from './domain/uuid.ts';
import { hideColumns } from './domain/columns.ts';
import { roleOf } from './auth.ts';
import { buildFilter, LineFilters } from './lines-filters.ts';

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


export const lines = createApi();

const listRoute = createRoute({
  method: 'get',
  path: '/lines',
  tags: ['lines'],
  summary: 'Список строк',
  request: { query: LineFilters },
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
  const filters = c.req.valid('query');
  const { status, limit, cursor } = filters;

  if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
    return problemResponse(
      c,
      new Problem(400, 'bad_request',
        `Неизвестный статус «${status}». Допустимые: ${STATUSES.join(', ')}`, 'status'),
    );
  }

  // Отбор по каждому полю (ФТ v2 п. 14) собирается в одном месте — `lines-filters.ts`.
  // Здесь только подстановка: условия и нумерация параметров живут там.
  const { where, params } = buildFilter(filters);

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
  // Закрытые колонки убираются ПЕРЕД отдачей (ФТ v2 п. 5): кладовщик законно
  // открывает список строк, но себестоимости в ответе быть не должно.
  return c.json({
    items: hideColumns(roleOf(c), rows.rows) as never[],
    nextCursor: next,
    total: Number(total.rows[0]!.n),
  }, 200);
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
  // То же и на одиночной строке: закрывать колонки только в списке значило бы
  // оставить открытую дверь рядом.
  return c.json(hideColumns(roleOf(c), r.rows)[0]!, 200);
});
