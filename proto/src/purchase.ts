import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Данные для решения о закупке (ФТ v2 п. 16).
//
// «Если позиция уже покупалась — подсказка „у кого и по какой цене“ по истории
// закупок и остаткам, плюс блок „Аналоги“ по связанной номенклатуре».
//
// Зачем это нужно снабженцу. Позицию можно купить у трёх поставщиков по разной цене,
// и «на глаз» выбрать дешевле не выйдет: цены менялись, а помнит их только база.
// Подсказка собирает в одном ответе три вещи, которые иначе пришлось бы сверять
// вручную: у кого брали, по какой цене и что ещё есть на складе.

export const purchase = createApi();

const HistoryRow = z.object({
  supplierId: z.string().nullable(),
  supplier: z.string().nullable(),
  price: z.string().nullable().describe('Цена закупки в той поставке'),
  quantity: z.string().nullable(),
  date: z.string().nullable(),
  orderNumber: z.string().nullable(),
});

const AnalogRow = z.object({
  id: z.string(),
  name: z.string(),
  article: z.string().nullable(),
  extCode: z.string().nullable(),
  price: z.string().nullable(),
  onHand: z.string().describe('Остаток на складе — замена нужна, только если пусто'),
});

purchase.openapi(createRoute({
  method: 'get',
  path: '/nomenclature/{id}/purchase-history',
  tags: ['purchase'],
  summary: 'У кого и по какой цене покупали, остаток и аналоги (ФТ v2 п. 16)',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Данные для закупки', content: { 'application/json': { schema: z.object({
      id: uuid, name: z.string(), article: z.string().nullable(),
      extCode: z.string().nullable(), brand: z.string().nullable(),
      price: z.string().nullable(),
      onHand: z.string().describe('Остаток на складе'),
      onOrder: z.string().describe('Уже заказано, но не пришло'),
      history: z.array(HistoryRow),
      analogs: z.array(AnalogRow),
    }) } } },
    404: { description: 'Номенклатура не найдена' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  const head = await pool.query<{
    id: string; name: string; article: string | null; ext_code: string | null;
    brand: string | null; price: string | null;
  }>(
    `select n.id, n.name, n.article, n.ext_code, b.name as brand, n.price::text
       from nomenclature n
       left join brand b on b.id = n.brand_id and b.deleted_at is null
      where n.id = $1 and n.deleted_at is null`,
    [id],
  );
  if (head.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Номенклатура ${id} не найдена`));
  }

  // История: строки, которые УЖЕ покупали. Признак покупки — поставщик в строке,
  // а не наличие заказа: бывает, что заказ отменён, а цена из него осталась полезной.
  const history = await pool.query<{
    supplier_id: string | null; supplier: string | null; price: string | null;
    quantity: string | null; date: string | null; number: string | null;
  }>(
    `select l.supplier_id, cp.name as supplier, l.cost_price::text as price,
            l.quantity::text, to_char(l.order_date, 'DD.MM.YYYY') as date,
            so.number
       from line l
       left join counterparty cp on cp.id = l.supplier_id and cp.deleted_at is null
       left join supplier_order so on so.id = l.supplier_order_id and so.deleted_at is null
      where l.nomenclature_id = $1 and not l.deleted and l.supplier_id is not null
      order by l.order_date desc nulls last, l.id desc
      limit 10`,
    [id],
  );

  // Аналоги — прямая связь. Ищем в ОБЕ стороны: связь могла быть заведена от любой
  // из двух позиций, и односторонний поиск половину аналогов потерял бы.
  const analogs = await pool.query<{
    id: string; name: string; article: string | null; ext_code: string | null;
    price: string | null; on_hand: string;
  }>(
    `select n.id, n.name, n.article, n.ext_code, n.price::text,
            coalesce((select sum(sb.on_hand) from stock_balance sb
                       where sb.nomenclature_id = n.id), 0)::text as on_hand
       from nomenclature n
      where n.deleted_at is null and n.id <> $1
        and (n.analog_id = $1
             or n.id = (select analog_id from nomenclature where id = $1))
      order by n.name
      limit 10`,
    [id],
  );

  const stock = await pool.query<{ on_hand: string; on_order: string }>(
    `select coalesce((select sum(sb.on_hand) from stock_balance sb
                       where sb.nomenclature_id = $1), 0)::text as on_hand,
            coalesce((select sum(l.quantity) from line l
                       where l.nomenclature_id = $1 and not l.deleted
                         and l.status in ('ordered', 'paid', 'in_transit')), 0)::text as on_order`,
    [id],
  );

  const h = head.rows[0]!;
  return c.json({
    id: h.id, name: h.name, article: h.article, extCode: h.ext_code,
    brand: h.brand, price: h.price,
    onHand: stock.rows[0]!.on_hand,
    onOrder: stock.rows[0]!.on_order,
    history: history.rows.map((r) => ({
      supplierId: r.supplier_id, supplier: r.supplier, price: r.price,
      quantity: r.quantity, date: r.date, orderNumber: r.number,
    })),
    analogs: analogs.rows.map((r) => ({
      id: r.id, name: r.name, article: r.article, extCode: r.ext_code,
      price: r.price, onHand: r.on_hand,
    })),
  }, 200);
});

// --- GET /suppliers — контрагенты-поставщики по алфавиту -----------------------------
//
// «Форма выбора поставщика — справочник „Контрагенты“ по алфавиту». Отдельный адрес,
// а не `?is_supplier=true` у общего справочника: снабженцу нужны ТОЛЬКО поставщики, и
// заказчики в списке выбора — это ошибка, которую он заметит уже в документе.

purchase.openapi(createRoute({
  method: 'get',
  path: '/suppliers',
  tags: ['purchase'],
  summary: 'Поставщики по алфавиту',
  responses: {
    200: { description: 'Поставщики', content: { 'application/json': { schema: z.object({
      items: z.array(z.object({
        id: z.string(), name: z.string(), inn: z.string().nullable(),
        /** Сколько раз у него покупали — по этому и выбирают. */
        purchases: z.number().int(),
      })),
      total: z.number().int(),
    }) } } },
  },
}), async (c) => {
  const r = await pool.query<{ id: string; name: string; inn: string | null; purchases: string }>(
    `select cp.id, cp.name, cp.inn,
            (select count(*) from line l
              where l.supplier_id = cp.id and not l.deleted)::text as purchases
       from counterparty cp
      where cp.deleted_at is null and cp.is_supplier
      order by cp.name`,
  );
  return c.json({
    items: r.rows.map((x) => ({ ...x, purchases: Number(x.purchases) })),
    total: r.rowCount ?? 0,
  }, 200);
});
