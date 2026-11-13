import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { SHIPMENT_STATUSES } from './domain/shipment-state.ts';

// Отгрузка: список, карточка и создание (3 операции).
//
// Путь K5 → M12 → M15: создать отгрузку по отмеченным строкам, отгрузить, закрыть
// после проверки документов. Движение — в `shipments-flow.ts` (лимит 200 строк на файл).
//
// Связь со строками уже есть: `line.shipment_doc_id` — столбец из карты §4.2 (метка L).
// Отдельная таблица строк отгрузки, как в legacy (`doc.shipment_item`), не нужна.

export const shipments = createApi();

// --- GET /shipments -----------------------------------------------------------------

const ListQuery = z.object({
  status: z.enum(SHIPMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

shipments.openapi(createRoute({
  method: 'get',
  path: '/shipments',
  tags: ['shipments'],
  summary: 'Список отгрузок',
  request: { query: ListQuery },
  responses: {
    200: { description: 'Отгрузки', content: { 'application/json': { schema: z.object({
      items: z.array(z.record(z.string(), z.unknown())), total: z.number().int(),
    }) } } },
    400: { description: 'Неизвестное состояние' },
  },
}), async (c) => {
  const { status, limit } = c.req.valid('query');
  const params: unknown[] = [];
  let where = 'where deleted_at is null';

  if (status) { params.push(status); where += ` and status = $${params.length}`; }
  params.push(limit);

  const r = await pool.query(
    `select s.id, s.number, s.date, s.status, s.counterparty_id, s.warehouse_id,
            s.zone_id, s.car_id, s.total, s.version,
            (select count(*) from line l where l.shipment_doc_id = s.id and not l.deleted) as lines
       from shipment s ${where} order by s.date desc, s.number limit $${params.length}`,
    params,
  );
  return c.json({ items: r.rows as never[], total: r.rowCount ?? 0 }, 200);
});

// --- GET /shipments/{id} --------------------------------------------------------------

shipments.openapi(createRoute({
  method: 'get',
  path: '/shipments/{id}',
  tags: ['shipments'],
  summary: 'Отгрузка со строками',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Отгрузка и её строки', content: { 'application/json': { schema: z.object({
      header: z.record(z.string(), z.unknown()),
      lines: z.array(z.record(z.string(), z.unknown())),
    }) } } },
    404: { description: 'Отгрузка не найдена' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const head = await pool.query(
    `select id, number, date, status, counterparty_id, warehouse_id, zone_id, car_id, total, version
       from shipment where id = $1 and deleted_at is null`,
    [id],
  );
  if (head.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Отгрузка ${id} не найдена`));
  }

  const lines = await pool.query(
    `select l.id, l.status, l.quantity, l.cell_id,
            (select code from storage_cell c where c.id = l.cell_id) as cell,
            f.fact_name
       from line l left join line_fact f on f.id = l.id
      where l.shipment_doc_id = $1 and not l.deleted
      order by l.id`,
    [id],
  );
  return c.json({ header: head.rows[0] as never, lines: lines.rows as never[] }, 200);
});

// --- POST /shipments — создание по отмеченным строкам (K5) ---------------------------

/**
 * Статусы, из которых строку можно отгрузить.
 *
 * `ready_to_ship` — обычный путь (K3 «Собрано»).
 * `paid`, `in_transit` — самовывоз: клиент забирает сам, комплектация не нужна (N4).
 */
const SHIPPABLE = ['ready_to_ship', 'paid', 'in_transit'];

shipments.openapi(createRoute({
  method: 'post',
  path: '/shipments',
  tags: ['shipments'],
  summary: 'Создать отгрузку по отмеченным строкам (K5)',
  request: { body: { content: { 'application/json': { schema: z.object({
    carId: uuid.optional().describe('Автомобиль отгрузки'),
    zoneId: uuid.optional().describe('Зона склада'),
  }) } } } },
  responses: {
    201: { description: 'Отгрузка создана', content: { 'application/json': { schema: z.object({
      id: uuid, number: z.string(), lines: z.number().int(), skipped: z.array(z.string()),
    }) } } },
    409: { description: 'Нет отмеченных строк, готовых к отгрузке' },
  },
}), async (c) => {
  const { carId, zoneId } = c.req.valid('json');

  const marked = await pool.query<{ id: string; status: string; order_id: string | null; name: string }>(
    `select l.id, l.status, l.customer_order_id as order_id,
            coalesce(f.fact_name, l.id::text) as name
       from line l join line_mark m on m.id = l.id and m.marked
       left join line_fact f on f.id = l.id
      where not l.deleted and l.shipment_doc_id is null
      order by l.order_date, l.id`,
  );

  const ready = marked.rows.filter((l) => SHIPPABLE.includes(l.status));
  if (ready.length === 0) {
    const why = marked.rowCount === 0
      ? 'Нет отмеченных строк.'
      : `Отмеченные строки не готовы к отгрузке (статусы: ${[...new Set(marked.rows.map((l) => l.status))].join(', ')}).`;
    return problemResponse(c, new Problem(409, 'nothing_marked',
      `${why} К отгрузке годны: ${SHIPPABLE.join(', ')}.`));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    const seq = await client.query<{ n: string }>(
      `select (coalesce(max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::bigint), 0) + 1)::text as n
         from shipment where number like 'ОТ-%'`,
    );
    const number = `ОТ-${String(seq.rows[0]!.n).padStart(4, '0')}`;

    const head = await client.query<{ id: string }>(
      `insert into shipment (number, status, operation, counterparty_id, customer_order_id,
                             warehouse_id, zone_id, car_id)
       values ($1, 'new', 'sale',
               (select customer_id from line where id = $2),
               (select customer_order_id from line where id = $2),
               '44444444-4444-4444-4444-444444444401', $3, $4)
       returning id`,
      [number, ready[0]!.id, zoneId ?? null, carId ?? null],
    );
    const shipmentId = head.rows[0]!.id;

    for (const line of ready) {
      // Строка только ПРИВЯЗЫВАЕТСЯ к отгрузке: товар в этот момент ещё на складе.
      // Статус меняет переход `POST /shipments/{id}/ship` (M12) — иначе «отгружено»
      // появлялось бы в момент оформления бумаги.
      await client.query(
        `update line set shipment_doc_id = $2, version = version + 1, updated_at = now()
          where id = $1`,
        [line.id, shipmentId],
      );
      await client.query(`update line_mark set marked = false where id = $1`, [line.id]);
    }

    await client.query('commit');
    const skipped = marked.rows.filter((l) => !SHIPPABLE.includes(l.status))
      .map((l) => `${l.name}: из статуса «${l.status}» отгрузка не создаётся`);
    return c.json({ id: shipmentId, number, lines: ready.length, skipped }, 201);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
