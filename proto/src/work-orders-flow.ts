import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { WORK_ORDER_STATES, checkWorkOrderTransition } from './domain/work-order-state.ts';

// Движение заказ-наряда: добавить работу, перевести в состояние, закрыть (G9).
// Вынесено из `work-orders.ts` — на группу из 5–7 операций один файл не влезает
// (та же закономерность, что у возвратов и отгрузки).

export const workOrdersFlow = createApi();

interface WorkOrderHead {
  id: string;
  number: string | null;
  status: string;
}

async function loadWorkOrder(id: string): Promise<WorkOrderHead> {
  const r = await pool.query<WorkOrderHead>(
    `select id, number, status from work_order where id = $1 and deleted_at is null`,
    [id],
  );
  if (r.rowCount === 0) throw new Problem(404, 'not_found', `Заказ-наряд ${id} не найден`);
  return r.rows[0]!;
}

/**
 * Достаёт наряд или возвращает ошибку.
 *
 * Возвращается САМА ошибка, а не готовый ответ: `problemResponse` имеет тип `never`
 * (так требует Hono для динамического статуса), и сохранение его результата
 * в поле ломает вывод типа. Ответ строит обработчик — там `never` уместен.
 */
async function loadOrProblem(id: string): Promise<{ head: WorkOrderHead } | { problem: Problem }> {
  try {
    return { head: await loadWorkOrder(id) };
  } catch (e) {
    if (e instanceof Problem) return { problem: e };
    throw e;
  }
}

// --- POST /work-orders/{id}/labor — добавить работу ----------------------------------

workOrdersFlow.openapi(createRoute({
  method: 'post',
  path: '/work-orders/{id}/labor',
  tags: ['repair'],
  summary: 'Добавить работу в заказ-наряд (нормо-часы)',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({
      name: z.string().min(1).describe('Название работы'),
      normHours: z.string().describe('Нормо-часы'),
      salePrice: z.string().optional().describe('Цена работы'),
      nomenclatureId: uuid.optional(),
      serviceTypeId: uuid.optional(),
    }) } } },
  },
  responses: {
    201: { description: 'Работа добавлена', content: { 'application/json': { schema: z.object({
      lineId: uuid, total: z.string(),
    }) } } },
    404: { description: 'Заказ-наряд не найден' },
    409: { description: 'Закрытый наряд не правится' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const loaded = await loadOrProblem(id);
  if ('problem' in loaded) return problemResponse(c, loaded.problem);

  if (loaded.head!.status === 'closed') {
    return problemResponse(c, new Problem(409, 'bad_transition',
      'Закрытый заказ-наряд не правится: работы уже выполнены и предъявлены.'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    // Работа — это строка с нормо-часами. `service_type_id` отличает её от запчасти,
    // ровно как это делал legacy, разделяя работы и запчасти в печатной форме.
    const line = await client.query<{ id: string }>(
      `insert into line (work_order_id, operation, status, quantity, nomenclature_id,
                         service_type_id, norm_hours, sale_price, order_date, comment)
       values ($1, 'sale', 'new', 1, $2, $3, $4, $5, current_date, $6)
       returning id`,
      [id, body.nomenclatureId ?? null, body.serviceTypeId ?? null,
        body.normHours, body.salePrice ?? null, body.name],
    );
    const lineId = line.rows[0]!.id;

    // Название работы храним в факте строки: отдельного поля «название работы»
    // в карте §4.2 нет, а `line_fact.fact_name` — это ровно «как назвал клиент».
    await client.query(
      `insert into line_fact (id, fact_name, fact_qty) values ($1, $2, $3)`,
      [lineId, body.name, body.normHours],
    );

    // Итог наряда пересчитывается здесь, а не на клиенте: иначе экран и бланк
    // показывали бы разные суммы.
    //
    // Работа считается как НОРМО-ЧАСЫ × цена, а не количество × цена: у работы
    // количество всегда 1, и часы в нём не выражаются. Запчасть — количество × цена.
    // Различие ровно то же, по которому строки делятся на работы и запчасти.
    const total = await client.query<{ t: string }>(
      `select coalesce(sum(
                case when norm_hours is not null
                     then norm_hours * coalesce(sale_price, 0)
                     else coalesce(quantity, 0) * coalesce(sale_price, 0)
                end), 0)::text as t
         from line where work_order_id = $1 and not deleted`,
      [id],
    );
    await client.query(`update work_order set total = $2 where id = $1`, [id, total.rows[0]!.t]);

    await client.query('commit');
    return c.json({ lineId, total: total.rows[0]!.t }, 201);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});

// --- POST /work-orders/{id}/transition — перевод состояния ---------------------------

workOrdersFlow.openapi(createRoute({
  method: 'post',
  path: '/work-orders/{id}/transition',
  tags: ['repair'],
  summary: 'Перевести заказ-наряд: в работу / закрыть (G9)',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({
      to: z.enum(['in_work', 'closed']),
    }) } } },
  },
  responses: {
    200: { description: 'Состояние изменено', content: { 'application/json': { schema: z.object({
      id: uuid, status: z.string(), lines: z.number().int(),
    }) } } },
    404: { description: 'Заказ-наряд не найден' },
    409: { description: 'Недопустимый переход' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');
  const { to } = c.req.valid('json');

  const loaded = await loadOrProblem(id);
  if ('problem' in loaded) return problemResponse(c, loaded.problem);

  const denial = checkWorkOrderTransition(loaded.head!.status, to);
  if (denial) return problemResponse(c, new Problem(409, 'bad_transition', denial));

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `update work_order set status = $2, version = version + 1, updated_at = now() where id = $1`,
      [id, to],
    );

    const lineStatus = WORK_ORDER_STATES[to].lineStatus;
    const lines = lineStatus
      ? await client.query(
          `update line set status = $2, version = version + 1, updated_at = now()
            where work_order_id = $1 and not deleted`,
          [id, lineStatus],
        )
      : { rowCount: 0 };

    await client.query('commit');
    return c.json({ id, status: to, lines: lines.rowCount ?? 0 }, 200);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});

export { loadWorkOrder, loadOrProblem };
