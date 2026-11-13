import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Неопознанные позиции: A1 «создать в папке Не опознанные» и K8 «розыск позиции» (3 операции).
//
// Позиция попадает сюда, когда кладовщик не может сопоставить товар с номенклатурой:
// пришло не то, что заказывали, или артикул не читается. Пока позиция не опознана,
// её нельзя ни зарезервировать, ни отгрузить — она лежит в зоне «Неопознанные»,
// и её ищет либо кладовщик (K8), либо администратор (A1).
//
// Операции работают со СТРОКОЙ, а не с отдельной сущностью: неопознанная позиция —
// это строка без номенклатуры, лежащая в зоне неопознанных. Отдельная таблица
// завела бы вторую жизнь одной и той же строки.

export const unidentified = createApi();

/** Зона неопознанных — из модели (Z5). */
const ZONE_UNIDENTIFIED = '99999999-9999-9999-9999-999999999904';

// --- GET /unidentified — список позиций, ждущих опознания ----------------------------

unidentified.openapi(createRoute({
  method: 'get',
  path: '/unidentified',
  tags: ['warehouse'],
  summary: 'Позиции, ждущие опознания (K8, A1)',
  responses: {
    200: { description: 'Неопознанные позиции', content: { 'application/json': { schema: z.object({
      items: z.array(z.object({
        id: z.string(),
        status: z.string(),
        quantity: z.string().nullable(),
        fact_name: z.string().nullable(),
        fact_article: z.string().nullable(),
        plate: z.string().nullable(),
        cell: z.string().nullable(),
        comment: z.string().nullable(),
      })),
      total: z.number().int(),
    }) } } },
  },
}), async (c) => {
  // Признак неопознанной позиции — ОТСУТСТВИЕ номенклатуры. Зона лишь указывает,
  // где её искать: позиция может лежать не в своей зоне, и терять её из-за этого нельзя.
  const r = await pool.query(
    `select l.id, l.status, l.quantity::text,
            f.fact_name, f.fact_article, f.vehicle_plate as plate,
            (select code from storage_cell c where c.id = l.cell_id) as cell,
            l.comment
       from line l
       left join line_fact f on f.id = l.id
      where not l.deleted and l.nomenclature_id is null
      order by l.order_date, l.id`,
  );
  return c.json({ items: r.rows as never[], total: r.rowCount ?? 0 }, 200);
});

// --- POST /lines/{id}/unidentified — отправить в неопознанные (A1) -------------------

unidentified.openapi(createRoute({
  method: 'post',
  path: '/lines/{id}/unidentified',
  tags: ['warehouse'],
  summary: 'Отправить позицию в неопознанные (A1)',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({
      comment: z.string().optional().describe('Что видно: описание, номер фото'),
    }) } } },
  },
  responses: {
    200: { description: 'Позиция в зоне неопознанных', content: { 'application/json': { schema: z.object({
      id: uuid, zone: z.string(), cell: z.string().nullable(),
    }) } } },
    404: { description: 'Строка не найдена' },
    409: { description: 'Позиция уже опознана' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const { comment } = c.req.valid('json');

  const line = await pool.query<{ nomenclature_id: string | null }>(
    `select nomenclature_id from line where id = $1 and not deleted`, [id],
  );
  if (line.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }
  if (line.rows[0]!.nomenclature_id) {
    return problemResponse(c, new Problem(409, 'already_identified',
      'Позиция уже сопоставлена с номенклатурой: отправлять её в неопознанные незачем. ' +
      'Сначала снимите сопоставление.'));
  }

  const cell = await pool.query<{ id: string; code: string | null }>(
    `select id, code from storage_cell
      where zone_id = $1 and not blocked and deleted_at is null order by code limit 1`,
    [ZONE_UNIDENTIFIED],
  );

  await pool.query(
    `update line set zone_id = $2, cell_id = $3,
                      comment = coalesce($4, comment),
                      version = version + 1, updated_at = now()
      where id = $1`,
    [id, ZONE_UNIDENTIFIED, cell.rows[0]?.id ?? null, comment ?? null],
  );

  return c.json({
    id,
    zone: 'UNK',
    cell: cell.rows[0]?.code ?? null,
  }, 200);
});

// --- POST /lines/{id}/bind — опознать позицию (K8) ----------------------------------

unidentified.openapi(createRoute({
  method: 'post',
  path: '/lines/{id}/bind',
  tags: ['warehouse'],
  summary: 'Сопоставить позицию с номенклатурой (K8)',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({
      nomenclatureId: uuid,
      /** Куда положить после опознания. Без него позиция остаётся в зоне неопознанных. */
      zoneId: uuid.optional(),
    }) } } },
  },
  responses: {
    200: { description: 'Позиция опознана', content: { 'application/json': { schema: z.object({
      id: uuid, nomenclature: z.string(), zone: z.string().nullable(), cell: z.string().nullable(),
    }) } } },
    400: { description: 'Номенклатура или зона не найдена' },
    404: { description: 'Строка не найдена' },
    409: { description: 'Позиция уже опознана' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const { nomenclatureId, zoneId } = c.req.valid('json');

  const nom = await pool.query<{ name: string }>(
    `select name from nomenclature where id = $1 and deleted_at is null`, [nomenclatureId],
  );
  if (nom.rowCount === 0) {
    return problemResponse(c, new Problem(400, 'bad_request',
      `Номенклатура ${nomenclatureId} не найдена`, 'nomenclatureId'));
  }

  const line = await pool.query<{ nomenclature_id: string | null }>(
    `select nomenclature_id from line where id = $1 and not deleted`, [id],
  );
  if (line.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }
  if (line.rows[0]!.nomenclature_id) {
    return problemResponse(c, new Problem(409, 'already_identified',
      'Позиция уже сопоставлена: повторное сопоставление переписало бы историю.'));
  }

  // После опознания позиция обычно уезжает на склад (K2), но это отдельное решение
  // кладовщика: без `zoneId` она остаётся где лежала.
  let cell: string | null = null;
  if (zoneId) {
    const zc = await pool.query<{ id: string }>(
      `select id from storage_cell where zone_id = $1 and not blocked and deleted_at is null
        order by code limit 1`,
      [zoneId],
    );
    cell = zc.rows[0]?.id ?? null;
  }

  await pool.query(
    `update line set nomenclature_id = $2,
                      zone_id = coalesce($3, zone_id),
                      cell_id = coalesce($4, cell_id),
                      version = version + 1, updated_at = now()
      where id = $1`,
    [id, nomenclatureId, zoneId ?? null, cell],
  );

  const zone = zoneId
    ? (await pool.query<{ code: string | null }>(`select code from warehouse_zone where id = $1`, [zoneId])).rows[0]?.code
    : null;
  const cellCode = cell
    ? (await pool.query<{ code: string | null }>(`select code from storage_cell where id = $1`, [cell])).rows[0]?.code
    : null;

  return c.json({ id, nomenclature: nom.rows[0]!.name, zone: zone ?? null, cell: cellCode ?? null }, 200);
});
