import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Запчасть в заказ-наряде (1 операция).
//
// Закрывает пробел B3 из аудита бизнес-функций: карточка наряда умела ПОКАЗЫВАТЬ
// запчасти, но создать строку-запчасть с `work_order_id` не могла ни одна операция.
// Без этого не работает и автосписание (Q4): списывать было бы нечего.
//
// Запчасть — та же строка `line`: работа отличается от товара ЗНАЧЕНИЯМИ полей
// (у работы заполнены нормо-часы, у запчасти — нет), а не формой. Так же делил
// строки legacy, и по этому же признаку их делит карточка наряда.

export const workOrdersParts = createApi();

workOrdersParts.openapi(createRoute({
  method: 'post',
  path: '/work-orders/{id}/part',
  tags: ['repair'],
  summary: 'Добавить запчасть в заказ-наряд (B3)',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({
      nomenclatureId: uuid,
      quantity: z.string().describe('Количество'),
      salePrice: z.string().optional().describe('Цена продажи'),
      costPrice: z.string().optional().describe('Себестоимость — для расчёта затрат'),
      comment: z.string().optional(),
    }) } } },
  },
  responses: {
    201: { description: 'Запчасть добавлена', content: { 'application/json': { schema: z.object({
      lineId: uuid, total: z.string(),
    }) } } },
    400: { description: 'Номенклатура не найдена' },
    404: { description: 'Заказ-наряд не найден' },
    409: { description: 'Закрытый наряд не правится' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const order = await pool.query<{ status: string }>(
    `select status from work_order where id = $1 and deleted_at is null`, [id],
  );
  if (order.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Заказ-наряд ${id} не найден`));
  }
  if (order.rows[0]!.status === 'closed') {
    return problemResponse(c, new Problem(409, 'bad_transition',
      'Закрытый заказ-наряд не правится: запчасти уже списаны и предъявлены.'));
  }

  const nom = await pool.query<{ name: string }>(
    `select name from nomenclature where id = $1 and deleted_at is null`, [body.nomenclatureId],
  );
  if (nom.rowCount === 0) {
    return problemResponse(c, new Problem(400, 'bad_request',
      `Номенклатура ${body.nomenclatureId} не найдена`, 'nomenclatureId'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    // Нормо-часы НЕ заполняются: именно их отсутствие делает строку запчастью,
    // и именно по этому признаку автосписание при закрытии наряда отличит
    // запчасть от работы.
    const line = await client.query<{ id: string }>(
      `insert into line (work_order_id, operation, status, quantity, nomenclature_id,
                         sale_price, cost_price, order_date, comment)
       values ($1, 'sale', 'new', $2, $3, $4, $5, current_date, $6)
       returning id`,
      [id, body.quantity, body.nomenclatureId, body.salePrice ?? null,
        body.costPrice ?? null, body.comment ?? null],
    );
    const lineId = line.rows[0]!.id;

    await client.query(
      `insert into line_fact (id, fact_name, fact_qty) values ($1, $2, $3)`,
      [lineId, nom.rows[0]!.name, body.quantity],
    );

    const total = await recalcTotal(client, id);
    await client.query('commit');
    return c.json({ lineId, total }, 201);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});

/**
 * Итог наряда: работы считаются как нормо-часы × цена, запчасти — как количество × цена.
 *
 * Различие обязательное: у работы количество всегда 1, и часы в нём не выражаются.
 * Общая формула «количество × цена» дала бы по работе цену в 1 рубль вместо
 * стоимости нормо-часа.
 */
export async function recalcTotal(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { t: string }[] }> },
  workOrderId: string,
): Promise<string> {
  const r = await client.query(
    `select coalesce(sum(
              case when norm_hours is not null
                   then norm_hours * coalesce(sale_price, 0)
                   else coalesce(quantity, 0) * coalesce(sale_price, 0)
              end), 0)::text as t
       from line where work_order_id = $1 and not deleted`,
    [workOrderId],
  );
  const total = r.rows[0]!.t;
  await client.query(`update work_order set total = $2 where id = $1`, [workOrderId, total]);
  return total;
}
