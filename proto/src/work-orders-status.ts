import { createRoute, z } from '@hono/zod-openapi';
import { guard } from './auth.ts';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { WORK_ORDER_STATES, checkWorkOrderTransition } from './domain/work-order-state.ts';
import { loadOrProblem } from './work-orders-flow.ts';

// Перевод состояния заказ-наряда: в работу и закрытие (G9).
//
// Вынесено из `work-orders-flow.ts`: добавление исполнителя (Q3) добавило
// проверку и параметр, и файл перевалил за 200 строк.

export const workOrdersStatus = createApi();

// --- POST /work-orders/{id}/transition — перевод состояния ---------------------------

workOrdersStatus.openapi(createRoute({
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
  const noRight = guard(c, 'work.execute');
  if (noRight) return problemResponse(c, noRight);


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

    // Автосписание запчастей (Q4). Делается В ТОЙ ЖЕ транзакции, что и закрытие:
    // иначе наряд закрыт, а запчасть на складе числится — ровно то расхождение,
    // из-за которого ручное списание «забывается».
    const written = to === 'closed' ? await writeOffParts(client, id) : 0;

    await client.query('commit');
    return c.json({ id, status: to, lines: lines.rowCount ?? 0, writtenOff: written }, 200);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});

/**
 * Списывает запчасти закрытого наряда и возвращает число списанных.
 *
 * Списываются только ЗАПЧАСТИ: у работы тоже бывает номенклатура, но её нормо-часы
 * не пусты, и списывать услугу со склада нельзя — она не лежит на складе.
 *
 * Место списания берётся ИЗ ОСТАТКА, а не из строки наряда: строка не знает, откуда
 * возьмут деталь. Если списать «в никуда» (warehouse_id = null), остаток разъедется
 * на две строки — «4 на складе» и «−1 неизвестно где», — и кладовщик увидит товар
 * там, где его уже нет.
 *
 * Отбор идёт по строкам наряда, а не по остатку: списываем ровно заказанное.
 * Недостача остатка — отдельный вопрос кладовщика, и молча урезать количество
 * здесь значило бы её скрыть.
 */
async function writeOffParts(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> },
  workOrderId: string,
): Promise<number> {
  const parts = await client.query(
    `select l.id, l.nomenclature_id, l.quantity
       from line l
      where l.work_order_id = $1 and not l.deleted
        and l.nomenclature_id is not null
        and l.norm_hours is null
        and not exists (select 1 from stock_move sm
                         where sm.line_id = l.id and sm.kind = 'write_off')`,
    [workOrderId],
  );

  const rows = parts.rows as {
    id: string; nomenclature_id: string; quantity: string;
  }[];

  for (const p of rows) {
    // Откуда списываем: место с наибольшим остатком. Если остатка нет вовсе,
    // списание всё равно проходит — недостача должна быть ВИДНА, а не скрыта
    // отказом «нечего списывать».
    const place = await client.query(
      `select warehouse_id, cell_id, batch_id from stock_balance
        where nomenclature_id = $1 and on_hand > 0
        order by on_hand desc limit 1`,
      [p.nomenclature_id],
    );
    const at = (place.rows[0] ?? {}) as { warehouse_id?: string; cell_id?: string; batch_id?: string };

    await client.query(
      `insert into stock_move (nomenclature_id, warehouse_id, cell_id, batch_id,
                               line_id, work_order_id, kind, quantity, comment)
       values ($1, $2, $3, $4, $5, $6, 'write_off', $7, 'Списание по заказ-наряду')`,
      [p.nomenclature_id, at.warehouse_id ?? null, at.cell_id ?? null, at.batch_id ?? null,
        p.id, workOrderId, p.quantity],
    );
  }

  return rows.length;
}
