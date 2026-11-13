import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { uuid } from './domain/uuid.ts';

// Правка полей строки. Вынесено из `lines-mutations.ts`: файл перевалил за 200 строк,
// а правило «≤ 200 строк» существует потому, что в большом файле теряется контекст.
//
// Каждая правка обязана:
//   • поддерживать If-Match (версия) — иначе два оператора затрут правки друг друга;
//   • менять только РАЗРЕШЁННЫЕ поля — вычисляемые (`Сумма`, `Партия`, `ЯчейкаСклада`)
//     и служебные править нельзя;
//   • увеличивать version, иначе следующий If-Match не сработает.

export const fields = createApi();

export interface CurrentLine {
  version: number;
  status: string;
  signed: boolean;
}

/** Текущая версия и статус строки, либо 404. */
export async function loadLine(id: string): Promise<CurrentLine> {
  const r = await pool.query<{ version: string; status: string; signed_original: boolean }>(
    `select version::text, status, coalesce(signed_original, false) as signed_original
       from line where id = $1 and not deleted`,
    [id],
  );
  if (r.rowCount === 0) throw new Problem(404, 'not_found', `Строка ${id} не найдена`);
  const row = r.rows[0]!;
  return { version: Number(row.version), status: row.status, signed: row.signed_original };
}

/**
 * Поля, которые оператор правит вручную.
 *
 * Девять колонок контракта помечены `writable: false` — они ВЫЧИСЛЯЕМЫЕ, а не
 * закрытые правами: `ОтметкаСтроки`, `Порядок`, `НоменклатураАртикул`,
 * `КоличествоВРезерве`, `КоличествоВПути`, `Партия`, `ЯчейкаСклада`,
 * `ФормаОплаты`, `Сумма`. Их нельзя править даже администратору.
 */
const EDITABLE: Record<string, string> = {
  quantity: 'quantity',
  sale_price: 'sale_price',
  cost_price: 'cost_price',
  rrc: 'rrc',
  norm_hours: 'norm_hours',
  comment: 'comment',
  comment2: 'comment2',
  urgency: 'urgency',
  territory: 'territory',
  signed_original: 'signed_original',
  nomenclature_id: 'nomenclature_id',
  batch_id: 'batch_id',
  cell_id: 'cell_id',
  zone_id: 'zone_id',
  warehouse_id: 'warehouse_id',
};

const PatchBody = z.object({
  field: z.string().min(1).describe('Имя колонки, например quantity или sale_price'),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/lines/{id}',
  tags: ['lines'],
  summary: 'Изменить поле строки (If-Match: версия)',
  request: {
    params: z.object({ id: uuid }),
    headers: z.object({ 'if-match': z.string().optional() }),
    body: { content: { 'application/json': { schema: PatchBody } } },
  },
  responses: {
    200: { description: 'Строка изменена', content: { 'application/json': { schema: z.object({ version: z.number() }) } } },
    400: { description: 'Поле не редактируется' },
    404: { description: 'Строка не найдена' },
    409: { description: 'Конфликт версий' },
  },
});

fields.openapi(patchRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { field, value } = c.req.valid('json');
  const ifMatch = c.req.valid('header')['if-match'];

  const column = EDITABLE[field];
  if (!column) {
    const allowed = Object.keys(EDITABLE).join(', ');
    return problemResponse(
      c,
      new Problem(400, 'field_readonly',
        `Поле «${field}» не редактируется вручную. Редактируемые: ${allowed}`, field),
    );
  }

  const current = await loadLine(id);

  if (ifMatch !== undefined) {
    const expected = Number(ifMatch);
    if (Number.isFinite(expected) && expected !== current.version) {
      return problemResponse(
        c,
        new Problem(409, 'version_conflict',
          `Строку изменили: ожидалась версия ${expected}, в базе ${current.version}`),
      );
    }
  }

  const r = await pool.query(
    `update line set ${column} = $2, version = version + 1, updated_at = now()
      where id = $1 and not deleted
      returning version::text`,
    [id, value],
  );
  return c.json({ version: Number(r.rows[0]!.version) }, 200);
});
