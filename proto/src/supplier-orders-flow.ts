import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import {
  SUPPLIER_ORDER_STATES,
  checkSupplierOrderTransition,
  type SupplierOrderStatus,
} from './domain/supplier-order-state.ts';

// Движение заказа поставщику: подтвердить (P1), отменить, получить.
// Вынесено из `supplier-orders.ts` — на группу из 5–7 операций один файл не влезает
// (пятая группа подряд с той же закономерностью).

export const supplierOrdersFlow = createApi();

interface OrderHead {
  id: string;
  number: string | null;
  status: string;
}

export async function loadSupplierOrder(id: string): Promise<OrderHead> {
  const r = await pool.query<OrderHead>(
    `select id, number, status from supplier_order where id = $1 and deleted_at is null`,
    [id],
  );
  if (r.rowCount === 0) throw new Problem(404, 'not_found', `Заказ поставщику ${id} не найден`);
  return r.rows[0]!;
}

/** Переход состояния: общий обработчик для трёх операций. */
function addTransition(
  path: string,
  to: SupplierOrderStatus,
  title: string,
  allowedFrom: SupplierOrderStatus[],
): void {
  supplierOrdersFlow.openapi(createRoute({
    method: 'post',
    path,
    tags: ['purchase'],
    summary: title,
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: { description: 'Состояние изменено', content: { 'application/json': { schema: z.object({
        id: uuid, status: z.string(), lines: z.number().int(),
      }) } } },
      404: { description: 'Заказ не найден' },
      409: { description: 'Недопустимый переход' },
    },
  }), async (c) => {
    const { id } = c.req.valid('param');

    let head: OrderHead;
    try {
      head = await loadSupplierOrder(id);
    } catch (e) {
      if (e instanceof Problem) return problemResponse(c, e);
      throw e;
    }

    if (!allowedFrom.includes(head.status as SupplierOrderStatus)) {
      const denial = checkSupplierOrderTransition(head.status, to);
      return problemResponse(c, new Problem(409, 'bad_transition', denial!));
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update supplier_order set status = $2, version = version + 1, updated_at = now() where id = $1`,
        [id, to],
      );

      const lineStatus = SUPPLIER_ORDER_STATES[to].lineStatus;
      const lines = lineStatus
        ? await client.query(
            `update line set status = $2, version = version + 1, updated_at = now()
              where supplier_order_id = $1 and not deleted`,
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
}

// Подтверждение (P1): поставщик принял заказ в работу.
addTransition('/supplier-orders/{id}/confirm', 'confirmed',
  'Подтвердить заказ поставщику (P1)', ['new']);

// Получение: товар приехал. Строки идут на склад — размещение отдельным шагом (K2).
addTransition('/supplier-orders/{id}/receive', 'received',
  'Отметить получение товара', ['confirmed']);

// Отмена: строки возвращаются в «Новый», закупку можно начать заново.
addTransition('/supplier-orders/{id}/cancel', 'cancelled',
  'Отменить заказ у поставщика', ['new', 'confirmed']);

// --- DELETE /supplier-orders/{id} — удаление черновика --------------------------------

supplierOrdersFlow.openapi(createRoute({
  method: 'delete',
  path: '/supplier-orders/{id}',
  tags: ['purchase'],
  summary: 'Удалить черновик заказа поставщику',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Заказ удалён', content: { 'application/json': { schema: z.object({
      id: uuid, released: z.number().int(),
    }) } } },
    404: { description: 'Заказ не найден' },
    409: { description: 'Удалять можно только черновик' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  let head: OrderHead;
  try {
    head = await loadSupplierOrder(id);
  } catch (e) {
    if (e instanceof Problem) return problemResponse(c, e);
    throw e;
  }

  if (head.status !== 'new') {
    return problemResponse(c, new Problem(409, 'bad_transition',
      `Удалить можно только черновик, а заказ ${head.number} в состоянии ` +
      `«${SUPPLIER_ORDER_STATES[head.status as SupplierOrderStatus]?.title ?? head.status}». ` +
      'Используйте отмену — она сохраняет историю.'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    // Строки отвязываются от заказа: закупку начнут заново.
    const lines = await client.query(
      `update line set supplier_order_id = null, version = version + 1, updated_at = now()
        where supplier_order_id = $1 and not deleted`,
      [id],
    );
    await client.query(
      `update supplier_order set deleted_at = now(), version = version + 1 where id = $1`,
      [id],
    );
    await client.query('commit');
    return c.json({ id, released: lines.rowCount ?? 0 }, 200);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
