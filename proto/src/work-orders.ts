import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { WORK_ORDER_STATUSES } from './domain/work-order-state.ts';

// Заказ-наряд (ремонт, G1–G9): список, карточка, открытие (3 операции).
//
// Работы и запчасти — обычные строки `line` со ссылкой `line.work_order_id`:
// у строки уже есть `service_type_id` (вид услуги) и `norm_hours` (нормо-часы)
// из карты §4.2. Отдельная таблица работ, как в legacy `doc.work_order_labor`,
// не нужна: работа отличается от товара ЗНАЧЕНИЯМИ полей, а не формой.
//
// Движение заказ-наряда (работа, закрытие, правка) — в `work-orders-flow.ts`.

export const workOrders = createApi();

// --- GET /work-orders ----------------------------------------------------------------

const ListQuery = z.object({
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

workOrders.openapi(createRoute({
  method: 'get',
  path: '/work-orders',
  tags: ['repair'],
  summary: 'Список заказ-нарядов',
  request: { query: ListQuery },
  responses: {
    200: { description: 'Заказ-наряды', content: { 'application/json': { schema: z.object({
      items: z.array(z.record(z.string(), z.unknown())), total: z.number().int(),
    }) } } },
    400: { description: 'Неизвестное состояние' },
  },
}), async (c) => {
  const { status, limit } = c.req.valid('query');
  const params: unknown[] = [];
  let where = 'where w.deleted_at is null';

  if (status) { params.push(status); where += ` and w.status = $${params.length}`; }
  params.push(limit);

  const r = await pool.query(
    `select w.id, w.number, w.date, w.status, w.car_id, w.counterparty_id, w.total, w.version,
            c.name as car, c.vin
       from work_order w
       left join car c on c.id = w.car_id
       ${where} order by w.date desc, w.number limit $${params.length}`,
    params,
  );
  return c.json({ items: r.rows as never[], total: r.rowCount ?? 0 }, 200);
});

// --- GET /work-orders/{id} — наряд с работами и запчастями ---------------------------

workOrders.openapi(createRoute({
  method: 'get',
  path: '/work-orders/{id}',
  tags: ['repair'],
  summary: 'Заказ-наряд: работы и запчасти',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Наряд, работы и запчасти', content: { 'application/json': { schema: z.object({
      header: z.record(z.string(), z.unknown()),
      labor: z.array(z.record(z.string(), z.unknown())),
      parts: z.array(z.record(z.string(), z.unknown())),
    }) } } },
    404: { description: 'Заказ-наряд не найден' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const head = await pool.query(
    `select w.id, w.number, w.date, w.status, w.car_id, w.counterparty_id,
            w.service_type_id, w.total, w.version, c.name as car, c.vin, c.year
       from work_order w left join car c on c.id = w.car_id
      where w.id = $1 and w.deleted_at is null`,
    [id],
  );
  if (head.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Заказ-наряд ${id} не найден`));
  }

  // Работа отличается от запчасти наличием нормо-часов: это и есть признак,
  // по которому legacy делил строки на работы и запчасти.
  const lines = await pool.query(
    `select l.id, l.status, l.quantity, l.norm_hours, l.sale_price, l.service_type_id,
            n.name as nomenclature, f.fact_name,
            (l.norm_hours is not null) as is_labor
       from line l
       left join nomenclature n on n.id = l.nomenclature_id
       left join line_fact f on f.id = l.id
      where l.work_order_id = $1 and not l.deleted
      order by l.id`,
    [id],
  );

  const rows = lines.rows as { is_labor: boolean }[];
  return c.json({
    header: head.rows[0] as never,
    labor: rows.filter((r) => r.is_labor) as never[],
    parts: rows.filter((r) => !r.is_labor) as never[],
  }, 200);
});

// --- POST /work-orders — открытие (G1) -----------------------------------------------

workOrders.openapi(createRoute({
  method: 'post',
  path: '/work-orders',
  tags: ['repair'],
  summary: 'Открыть заказ-наряд (G1)',
  request: { body: { content: { 'application/json': { schema: z.object({
    carId: uuid.describe('Автомобиль, поступивший в ремонт'),
    counterpartyId: uuid.optional(),
    serviceTypeId: uuid.optional(),
  }) } } } },
  responses: {
    201: { description: 'Наряд открыт', content: { 'application/json': { schema: z.object({
      id: uuid, number: z.string(),
    }) } } },
    400: { description: 'Автомобиль не найден' },
  },
}), async (c) => {
  const { carId, counterpartyId, serviceTypeId } = c.req.valid('json');

  const car = await pool.query(`select 1 from car where id = $1 and deleted_at is null`, [carId]);
  if (car.rowCount === 0) {
    return problemResponse(c, new Problem(400, 'bad_request',
      `Автомобиль ${carId} не найден в справочнике`, 'carId'));
  }

  const seq = await pool.query<{ n: string }>(
    `select (coalesce(max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::bigint), 0) + 1)::text as n
       from work_order where number like 'ЗН-%'`,
  );
  const number = `ЗН-${String(seq.rows[0]!.n).padStart(4, '0')}`;

  const r = await pool.query<{ id: string }>(
    `insert into work_order (number, status, car_id, counterparty_id, organization_id, service_type_id)
     values ($1, 'new', $2, $3, '55555555-5555-5555-5555-555555555501', $4)
     returning id`,
    [number, carId, counterpartyId ?? null, serviceTypeId ?? null],
  );
  return c.json({ id: r.rows[0]!.id, number }, 201);
});
