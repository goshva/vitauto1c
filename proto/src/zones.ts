import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Зоны склада и перемещение строки между ними (2 операции).
//
// До этого строка умела только «попасть в ячейку». Но в модели склад имеет 12 зон,
// и товар перемещается МЕЖДУ ними по смыслу: после ремонта — на склад, брак —
// в зону возврата поставщику, неопознанное — в зону опознания, списанное по
// заказ-наряду — в зону списания.
//
// Перемещение меняет МЕСТО, а не количество: движения склада не создаются, остаток
// не меняется. Количество меняет приёмка, отгрузка и ручное движение (`/stock/moves`).

export const zones = createApi();

// --- GET /zones — зоны с ячейками ----------------------------------------------------

zones.openapi(createRoute({
  method: 'get',
  path: '/zones',
  tags: ['warehouse'],
  summary: 'Зоны склада с ячейками',
  request: { query: z.object({ purpose: z.string().optional() }) },
  responses: {
    200: { description: 'Зоны и их ячейки', content: { 'application/json': { schema: z.object({
      items: z.array(z.object({
        id: z.string(), code: z.string().nullable(), name: z.string(),
        purpose: z.string().nullable(), sort: z.number(),
        cells: z.array(z.object({ id: z.string(), code: z.string().nullable(), blocked: z.boolean() })),
        lines: z.number().int().describe('Сколько строк сейчас в зоне'),
      })),
      total: z.number().int(),
    }) } } },
  },
}), async (c) => {
  const { purpose } = c.req.valid('query');
  const params: unknown[] = [];
  let where = 'where z.deleted_at is null';
  if (purpose) { params.push(purpose); where += ` and z.purpose = $${params.length}`; }

  const r = await pool.query<{
    id: string; code: string | null; name: string; purpose: string | null; sort: number;
    cells: { id: string; code: string | null; blocked: boolean }[];
    lines: string;
  }>(
    `select z.id, z.code, z.name, z.purpose, z.sort,
            coalesce(json_agg(json_build_object('id', c.id, 'code', c.code, 'blocked', c.blocked)
                     order by c.code) filter (where c.id is not null), '[]') as cells,
            (select count(*) from line l where l.zone_id = z.id and not l.deleted) as lines
       from warehouse_zone z
       left join storage_cell c on c.zone_id = z.id and c.deleted_at is null
       ${where}
      group by z.id order by z.sort`,
    params,
  );

  return c.json({
    items: r.rows.map((x) => ({ ...x, lines: Number(x.lines) })) as never[],
    total: r.rowCount ?? 0,
  }, 200);
});

// --- POST /lines/{id}/zone — перемещение ---------------------------------------------

zones.openapi(createRoute({
  method: 'post',
  path: '/lines/{id}/zone',
  tags: ['warehouse'],
  summary: 'Переместить строку в зону склада',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({
      zoneId: uuid,
      cellId: uuid.optional().describe('Если не указана — берётся первая свободная ячейка зоны'),
      reason: z.string().optional().describe('Причина перемещения'),
    }) } } },
  },
  responses: {
    200: { description: 'Строка перемещена', content: { 'application/json': { schema: z.object({
      id: uuid, zone: z.string().nullable(), cell: z.string().nullable(), version: z.number(),
    }) } } },
    400: { description: 'Зона или ячейка не найдена, либо ячейка не из этой зоны' },
    404: { description: 'Строка не найдена' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const { zoneId, cellId } = c.req.valid('json');

  const zone = await pool.query<{ code: string | null; name: string }>(
    `select code, name from warehouse_zone where id = $1 and deleted_at is null`, [zoneId],
  );
  if (zone.rowCount === 0) {
    return problemResponse(c, new Problem(400, 'bad_request', `Зона ${zoneId} не найдена`, 'zoneId'));
  }

  // Ячейка обязана принадлежать выбранной зоне: иначе строка окажется «в ячейке
  // одной зоны, а в зоне другой», и складской отчёт разойдётся с реальностью.
  let cell = cellId ?? null;
  if (cell) {
    const check = await pool.query<{ blocked: boolean; code: string | null }>(
      `select blocked, code from storage_cell
        where id = $1 and zone_id = $2 and deleted_at is null`,
      [cell, zoneId],
    );
    if (check.rowCount === 0) {
      return problemResponse(c, new Problem(400, 'bad_request',
        `Ячейка ${cell} не принадлежит зоне «${zone.rows[0]!.name}»`, 'cellId'));
    }
    if (check.rows[0]!.blocked) {
      return problemResponse(c, new Problem(400, 'bad_request',
        `Ячейка ${check.rows[0]!.code} заблокирована`, 'cellId'));
    }
  } else {
    const free = await pool.query<{ id: string }>(
      `select id from storage_cell
        where zone_id = $1 and not blocked and deleted_at is null
        order by code limit 1`,
      [zoneId],
    );
    cell = free.rows[0]?.id ?? null;
  }

  const r = await pool.query<{ version: string }>(
    `update line set zone_id = $2, cell_id = $3, version = version + 1, updated_at = now()
      where id = $1 and not deleted
      returning version::text`,
    [id, zoneId, cell],
  );
  if (r.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }

  const cellCode = cell
    ? (await pool.query<{ code: string | null }>(`select code from storage_cell where id = $1`, [cell])).rows[0]?.code
    : null;

  return c.json({
    id,
    zone: zone.rows[0]!.code,
    cell: cellCode ?? null,
    version: Number(r.rows[0]!.version),
  }, 200);
});
