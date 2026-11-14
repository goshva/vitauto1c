import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse, ProblemSchema } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { VEHICLE_STATUSES } from './domain/fleet-state.ts';
import { LIST_SQL, toItem, type CarRow } from './fleet-query.ts';

// Карточка ТС и правка пробега/состояния (2 операции).
//
// Отдельно от `fleet.ts`: список и карточка читают ОДИН запрос и делят формулу
// срока ТО, но правка — это другое поведение (проверки, отказы, версия), и вместе
// файл перевалил за 200 строк.

export const fleetCard = createApi();

const CarSchema = z.object({
  id: z.string(), code: z.string().nullable(), name: z.string(),
  vin: z.string().nullable(), year: z.number().nullable(),
  mileage: z.number().nullable(), mileageAtService: z.number().nullable(),
  status: z.string(), statusTitle: z.string(),
  department: z.string().nullable(), plate: z.string().nullable(),
});

// --- GET /fleet/{id} -----------------------------------------------------------------

fleetCard.openapi(createRoute({
  method: 'get',
  path: '/fleet/{id}',
  tags: ['fleet'],
  summary: 'Карточка ТС: пробег, срок ТО, история нарядов',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Карточка ТС', content: { 'application/json': { schema: z.object({
      car: CarSchema,
      maintenance: z.object({
        due: z.boolean(), reason: z.string().nullable(),
        remainingKm: z.number().nullable(), remainingDays: z.number().nullable(),
      }),
      workOrders: z.array(z.object({
        id: z.string(), number: z.string().nullable(), date: z.string(),
        status: z.string(), total: z.string().nullable(),
      })),
    }) } } },
    404: { description: 'ТС не найдено', content: { 'application/json': { schema: ProblemSchema } } },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const r = await pool.query<CarRow>(`${LIST_SQL} and c.id = $1`, [id]);
  if (r.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `ТС ${id} не найдено`));
  }

  const item = toItem(r.rows[0]!, new Date());
  const wo = await pool.query<{ id: string; number: string | null; date: Date; status: string; total: string | null }>(
    `select id, number, date, status, total::text from work_order
      where car_id = $1 and deleted_at is null order by date desc limit 50`,
    [id],
  );

  const { due, ...car } = item;
  return c.json({
    car: car as never,
    maintenance: due as never,
    workOrders: wo.rows.map((x) => ({ ...x, date: x.date.toISOString().slice(0, 10) })) as never[],
  }, 200);
});

// --- PATCH /fleet/{id} ---------------------------------------------------------------

fleetCard.openapi(createRoute({
  method: 'patch',
  path: '/fleet/{id}',
  tags: ['fleet'],
  summary: 'Пробег, состояние и подразделение ТС; отметка о выполненном ТО',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({
      mileage: z.number().int().nonnegative().optional(),
      status: z.enum(['on_line', 'in_repair', 'written_off']).optional(),
      departmentId: uuid.nullable().optional(),
      /** Отметить ТО выполненным: точка отсчёта сдвигается на текущий пробег. */
      serviceDone: z.boolean().optional(),
    }) } } },
  },
  responses: {
    200: { description: 'ТС обновлено', content: { 'application/json': { schema: CarSchema } } },
    400: { description: 'Пустое тело или недопустимое состояние', content: { 'application/json': { schema: ProblemSchema } } },
    404: { description: 'ТС не найдено', content: { 'application/json': { schema: ProblemSchema } } },
    409: { description: 'Пробег меньше текущего', content: { 'application/json': { schema: ProblemSchema } } },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const current = await pool.query<{ mileage: number | null }>(
    `select mileage from car where id = $1 and deleted_at is null`, [id],
  );
  if (current.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `ТС ${id} не найдено`));
  }

  const sets: string[] = [];
  const params: unknown[] = [id];
  const push = (fragment: string, value: unknown) => {
    params.push(value);
    sets.push(`${fragment} = $${params.length}`);
  };

  if (body.mileage !== undefined) {
    const prev = current.rows[0]!.mileage ?? 0;
    // Пробег не уменьшается: это скрутка счётчика. Молча принять её — значит
    // испортить и расчёт ТО, и историю обслуживания.
    if (body.mileage < prev) {
      return problemResponse(c, new Problem(409, 'mileage_decrease',
        `Новый пробег ${body.mileage} меньше текущего ${prev}. Пробег не уменьшается — это скрутка счётчика.`,
        'mileage'));
    }
    push('mileage', body.mileage);
  }

  if (body.status !== undefined) {
    if (!(body.status in VEHICLE_STATUSES)) {
      return problemResponse(c, new Problem(400, 'bad_request',
        `Состояние «${body.status}» неизвестно. Допустимые: ${Object.keys(VEHICLE_STATUSES).join(', ')}.`,
        'status'));
    }
    push('status', body.status);
  }

  if (body.departmentId !== undefined) push('department_id', body.departmentId);

  if (body.serviceDone) {
    // Точка отсчёта — ТЕКУЩИЙ пробег (с учётом только что применённого).
    push('mileage_at_service', body.mileage ?? current.rows[0]!.mileage ?? 0);
    sets.push('last_service_at = now()');
  }

  if (sets.length === 0) {
    return problemResponse(c, new Problem(400, 'bad_request', 'Нечего менять: ни одно поле не задано.'));
  }

  await pool.query(
    `update car set ${sets.join(', ')}, version = version + 1, updated_at = now() where id = $1`,
    params,
  );

  const fresh = await pool.query<CarRow>(`${LIST_SQL} and c.id = $1`, [id]);
  const { due, ...car } = toItem(fresh.rows[0]!, new Date());
  return c.json(car as never, 200);
});
