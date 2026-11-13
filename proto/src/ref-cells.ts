import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';

// Ячейки склада и выпадающие списки. Вынесено из `refs.ts`: файл перевалил за
// 200 строк, а правило существует потому, что в большом файле теряется контекст.
//
// Ячейки отличаются от прочих справочников тем, что у них НЕТ колонки `name`:
// подпись — код ячейки. Поэтому они не вписываются в общую табличную форму `refs.ts`.

export const refCells = createApi();

// --- Ячейки склада: нужны для размещения (K2) -----------------------------------------

const CellsQuery = z.object({
  warehouseId: z.string().optional().describe('Ограничить складом'),
  zoneId: z.string().optional().describe('Ограничить зоной'),
});

const cellsRoute = createRoute({
  method: 'get',
  path: '/refs/cells',
  tags: ['refs'],
  summary: 'Ячейки склада (для размещения K2)',
  request: { query: CellsQuery },
  responses: {
    200: {
      description: 'Ячейки с зоной и складом',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(z.object({
              id: z.string(), code: z.string().nullable(), zone: z.string().nullable(),
              warehouse: z.string().nullable(), blocked: z.boolean(),
            })),
            total: z.number().int(),
          }),
        },
      },
    },
  },
});

refCells.openapi(cellsRoute, async (c) => {
  const { warehouseId, zoneId } = c.req.valid('query');
  const params: unknown[] = [];
  let where = 'where sc.deleted_at is null';

  if (warehouseId) { params.push(warehouseId); where += ` and sc.warehouse_id = $${params.length}`; }
  if (zoneId) { params.push(zoneId); where += ` and sc.zone_id = $${params.length}`; }

  const r = await pool.query(
    `select sc.id, sc.code, z.name as zone, w.name as warehouse, sc.blocked
       from storage_cell sc
       left join warehouse_zone z on z.id = sc.zone_id
       left join warehouse w on w.id = sc.warehouse_id
       ${where}
      order by sc.code`,
    params,
  );
  return c.json({ items: r.rows as never[], total: r.rowCount ?? 0 }, 200);
});

// --- Готовый список для выпадающего списка -------------------------------------------

/** Списки, у которых можно взять пары «значение — подпись». */
const OPTIONS = [
  { path: 'nomenclature', table: 'nomenclature' },
  { path: 'counterparties', table: 'counterparty' },
  { path: 'cells', table: 'storage_cell' },
] as const;

const OPTION_KINDS = ['nomenclature', 'counterparties', 'cells'] as const;

const optionsRoute = createRoute({
  method: 'get',
  path: '/options/{kind}',
  tags: ['refs'],
  summary: 'Пары «значение — подпись» для выпадающего списка',
  request: { params: z.object({ kind: z.enum(OPTION_KINDS) }) },
  responses: {
    200: {
      description: 'Варианты выбора',
      content: {
        'application/json': {
          schema: z.object({
            kind: z.string(),
            items: z.array(z.object({ value: z.string(), label: z.string() })),
          }),
        },
      },
    },
    400: { description: 'Нет такого списка (ошибка схемы)' },
  },
});

refCells.openapi(optionsRoute, async (c) => {
  const { kind } = c.req.valid('param');
  const spec = OPTIONS.find((o) => o.path === kind);
  if (!spec) {
    // Сюда попасть нельзя: `kind` проверен схемой. Ветка оставлена, чтобы типы
    // сходились без утверждения `!`, а не потому, что случай достижим.
    return problemResponse(c, new Problem(400, 'validation_failed',
      `Списка «${kind}» нет. Допустимые: ${OPTION_KINDS.join(', ')}`, 'kind'));
  }

  // Подпись собирается из кода и названия: оператору нужен артикул рядом с названием,
  // иначе две похожие позиции не различить. У ячейки названия нет — только код.
  const label = spec.table === 'storage_cell' ? 'code' : `coalesce(code, '') || ' · ' || name`;
  const r = await pool.query(
    `select id as value, ${label} as label from ${spec.table}
      where deleted_at is null order by label limit 500`,
  );
  return c.json({ kind, items: r.rows as never[] }, 200);
});
