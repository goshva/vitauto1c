import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { guard } from './auth.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Варианты поставки (ФТ v2 п. 12).
//
// ФТ: «В строке заказа — поле выбора варианта, если одна деталь встречается у
// нескольких поставщиков или по разным ценам: список вариантов с ценой и сроком по
// каждому».
//
// ЧТО ЗДЕСЬ ГЛАВНОЕ. Выбор варианта — не «приписать поставщика», а зафиксировать
// ЦЕНУ И СРОК. Поэтому выбранный вариант переносит свою цену в `cost_price` строки:
// снабженец выбрал не «Иванова вообще», а 395 ₽ через три недели, и именно это
// должно быть видно в строке и в заказе поставщику.

export const supplyOptions = createApi();

const Offer = z.object({
  id: z.string(),
  supplierId: z.string(),
  supplier: z.string(),
  price: z.string(),
  deliveryDays: z.number().int().nullable(),
  article: z.string().nullable(),
  comment: z.string().nullable(),
  /** Выбран ли этот вариант строкой. */
  chosen: z.boolean(),
});

/** Варианты для номенклатуры: цена и срок по каждому поставщику. */
export async function optionsFor(
  nomenclatureId: string,
  chosenId: string | null = null,
): Promise<z.infer<typeof Offer>[]> {
  const r = await pool.query<{
    id: string; supplier_id: string; supplier: string; price: string;
    delivery_days: number | null; article: string | null; comment: string | null;
  }>(
    `select o.id, o.supplier_id, cp.name as supplier, o.price::text,
            o.delivery_days, o.article, o.comment
       from supplier_offer o
       join counterparty cp on cp.id = o.supplier_id and cp.deleted_at is null
      where o.nomenclature_id = $1 and o.deleted_at is null
      -- Порядок: сначала по сроку, потом по цене.
      --
      -- NULL — это «срок НЕ УКАЗАН», и он идёт в конец. Поставить его первым значило
      -- бы обещать «быстрее всех», ничего об этом не зная. «Со склада, сегодня» —
      -- это срок 0, и он встаёт первым сам, без догадок со стороны сортировки.
      order by o.delivery_days nulls last, o.price`,
    [nomenclatureId],
  );
  return r.rows.map((x) => ({
    id: x.id,
    supplierId: x.supplier_id,
    supplier: x.supplier,
    price: x.price,
    deliveryDays: x.delivery_days,
    article: x.article,
    comment: x.comment,
    chosen: x.id === chosenId,
  }));
}

// --- GET /lines/{id}/supply-options --------------------------------------------------
supplyOptions.openapi(createRoute({
  method: 'get',
  path: '/lines/{id}/supply-options',
  tags: ['purchase'],
  summary: 'Варианты поставки для строки: у кого, по какой цене и в какой срок',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Варианты', content: { 'application/json': { schema: z.object({
      lineId: uuid,
      nomenclature: z.string().nullable(),
      chosen: z.string().nullable().describe('Идентификатор выбранного варианта'),
      items: z.array(Offer),
    }) } } },
    404: { description: 'Строка не найдена' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const line = await pool.query<{
    nomenclature_id: string | null; nomenclature: string | null;
    supplier_offer_id: string | null;
  }>(
    `select l.nomenclature_id, n.name as nomenclature, l.supplier_offer_id
       from line l
       left join nomenclature n on n.id = l.nomenclature_id and n.deleted_at is null
      where l.id = $1 and not l.deleted`,
    [id],
  );
  if (line.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }

  const row = line.rows[0]!;
  // У неопознанной позиции вариантов нет и быть не может: выбирать не из чего,
  // пока неясно, ЧТО покупать. Причина называется, а не отдаётся пустой список.
  const items = row.nomenclature_id
    ? await optionsFor(row.nomenclature_id, row.supplier_offer_id)
    : [];

  return c.json({
    lineId: id,
    nomenclature: row.nomenclature,
    chosen: row.supplier_offer_id,
    items,
  }, 200);
});

// --- POST /lines/{id}/supply-option --------------------------------------------------
supplyOptions.openapi(createRoute({
  method: 'post',
  path: '/lines/{id}/supply-option',
  tags: ['purchase'],
  summary: 'Выбрать вариант поставки: цена и срок переносятся в строку',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({
      offerId: uuid.describe('Идентификатор предложения поставщика'),
    }) } } },
  },
  responses: {
    200: { description: 'Вариант выбран', content: { 'application/json': { schema: z.object({
      id: uuid, supplier: z.string(), price: z.string(), deliveryDays: z.number().int().nullable(),
    }) } } },
    400: { description: 'Предложение не подходит этой строке' },
    404: { description: 'Строка или предложение не найдены' },
  },
}), async (c) => {
  const noRight = guard(c, 'purchase.create');
  if (noRight) return problemResponse(c, noRight);

  const { id } = c.req.valid('param');
  const { offerId } = c.req.valid('json');

  const line = await pool.query<{ nomenclature_id: string | null }>(
    `select nomenclature_id from line where id = $1 and not deleted`, [id]);
  if (line.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }

  const offer = await pool.query<{
    id: string; supplier_id: string; nomenclature_id: string; price: string;
    delivery_days: number | null; supplier: string;
  }>(
    `select o.id, o.supplier_id, o.nomenclature_id, o.price::text, o.delivery_days,
            cp.name as supplier
       from supplier_offer o
       join counterparty cp on cp.id = o.supplier_id
      where o.id = $1 and o.deleted_at is null`,
    [offerId],
  );
  if (offer.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Предложение ${offerId} не найдено`));
  }

  const o = offer.rows[0]!;
  // Предложение ДРУГОЙ позиции — это ошибка выбора, а не «пусть будет»: цена и
  // артикул у него чужие, и заказ ушёл бы не с тем кодом.
  if (o.nomenclature_id !== line.rows[0]!.nomenclature_id) {
    return problemResponse(c, new Problem(400, 'bad_request',
      'Предложение относится к другой номенклатуре: цена и артикул у него чужие.',
      'offerId'));
  }

  // Цена варианта едет в `cost_price`: снабженец выбрал не поставщика вообще, а
  // конкретную цену, и она должна быть видна в строке и в заказе поставщику.
  await pool.query(
    `update line
        set supplier_offer_id = $2, supplier_id = $3, cost_price = $4::numeric,
            version = version + 1, updated_at = now()
      where id = $1`,
    [id, o.id, o.supplier_id, o.price],
  );

  return c.json({
    id: o.id, supplier: o.supplier, price: o.price, deliveryDays: o.delivery_days,
  }, 200);
});
