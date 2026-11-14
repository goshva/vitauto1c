import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { LIST_SQL, REASON_TITLES, toItem, whereOf, type CarRow } from './fleet-query.ts';

// Автопарк: список ТС и список ТО (2 операции). Карточка и правка — в `fleet-card.ts`.
//
// Заказчик (Q2) определил автопарк как ядро: ТС — объект обслуживания, а не товар.
// Ключевое здесь — `/maintenance`: машины, которым пора на ТО, с НАЗВАННОЙ причиной.
// Список без причины бесполезен: механик не знает, ехать по сроку или потому,
// что кончился интервал пробега.

export const fleet = createApi();

const DueSchema = z.object({
  due: z.boolean(),
  reason: z.string().nullable().describe('mileage | days | never'),
  remainingKm: z.number().nullable().describe('Отрицательное — просрочено'),
  remainingDays: z.number().nullable(),
});

const CarSchema = z.object({
  id: z.string(), code: z.string().nullable(), name: z.string(),
  vin: z.string().nullable(), year: z.number().nullable(),
  mileage: z.number().nullable(), mileageAtService: z.number().nullable(),
  status: z.string(), statusTitle: z.string(),
  department: z.string().nullable(), plate: z.string().nullable(),
  due: DueSchema,
});

// --- GET /fleet ----------------------------------------------------------------------

fleet.openapi(createRoute({
  method: 'get',
  path: '/fleet',
  tags: ['fleet'],
  summary: 'Автопарк: ТС с пробегом, состоянием и подразделением',
  request: { query: z.object({
    departmentId: uuid.optional(),
    status: z.enum(['on_line', 'in_repair', 'written_off']).optional(),
  }) },
  responses: {
    200: { description: 'Список ТС', content: { 'application/json': { schema: z.object({
      items: z.array(CarSchema), total: z.number().int(),
    }) } } },
  },
}), async (c) => {
  const { sql, params } = whereOf(c.req.valid('query'));
  const r = await pool.query<CarRow>(`${LIST_SQL}${sql} order by c.code`, params);
  const now = new Date();

  return c.json({ items: r.rows.map((x) => toItem(x, now)) as never[], total: r.rowCount ?? 0 }, 200);
});

// --- GET /maintenance — что пора обслуживать -----------------------------------------

fleet.openapi(createRoute({
  method: 'get',
  path: '/maintenance',
  tags: ['fleet'],
  summary: 'ТС, которым пора на регламентное ТО, с причиной',
  responses: {
    200: { description: 'Список ТО', content: { 'application/json': { schema: z.object({
      items: z.array(z.object({
        id: z.string(), code: z.string().nullable(), name: z.string(),
        department: z.string().nullable(), mileage: z.number().nullable(),
        reason: z.string(), reasonTitle: z.string(),
        remainingKm: z.number().nullable(), remainingDays: z.number().nullable(),
      })),
      total: z.number().int(),
    }) } } },
  },
}), async (c) => {
  const r = await pool.query<CarRow>(`${LIST_SQL} order by c.code`, []);
  const now = new Date();

  const items = r.rows
    .map((x) => toItem(x, now))
    .filter((x) => x.due.due)
    // Списанная машина не обслуживается — ремонтировать её незачем.
    .filter((x) => x.status !== 'written_off')
    .map((x) => ({
      id: x.id, code: x.code, name: x.name, department: x.department, mileage: x.mileage,
      reason: x.due.reason!, reasonTitle: REASON_TITLES[x.due.reason!] ?? x.due.reason!,
      remainingKm: x.due.remainingKm, remainingDays: x.due.remainingDays,
    }));

  return c.json({ items, total: items.length }, 200);
});
