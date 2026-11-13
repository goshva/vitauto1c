import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { SHIPMENT_STATES, checkShipmentTransition } from './domain/shipment-state.ts';

// Движение отгрузки: отгрузить (M12, N4) и закрыть (M15). Плюс отмена.
// Вынесено из `shipments.ts` (лимит 200 строк на файл).
//
// Строки переходят ВМЕСТЕ с документом: иначе товар «застревает» в статусе отгрузки
// при закрытом документе — расхождение, которое находят на складе, а не в тесте.

export const shipmentsFlow = createApi();

interface ShipmentHead {
  id: string;
  number: string | null;
  status: string;
}

/** Отгрузка по идентификатору, либо Problem(404). */
async function loadShipment(id: string): Promise<ShipmentHead> {
  const r = await pool.query<ShipmentHead>(
    `select id, number, status from shipment where id = $1 and deleted_at is null`,
    [id],
  );
  if (r.rowCount === 0) throw new Problem(404, 'not_found', `Отгрузка ${id} не найдена`);
  return r.rows[0]!;
}

/** Переход состояния: общий обработчик для двух операций. */
function addTransition(path: string, to: 'shipped' | 'closed', title: string): void {
  shipmentsFlow.openapi(createRoute({
    method: 'post',
    path,
    tags: ['shipments'],
    summary: title,
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: { description: 'Состояние изменено', content: { 'application/json': { schema: z.object({
        id: uuid, status: z.string(), lines: z.number().int(),
      }) } } },
      404: { description: 'Отгрузка не найдена' },
      409: { description: 'Недопустимый переход' },
    },
  }), async (c) => {
    const { id } = c.req.valid('param');

    let head: ShipmentHead;
    try {
      head = await loadShipment(id);
    } catch (e) {
      if (e instanceof Problem) return problemResponse(c, e);
      throw e;
    }

    const denial = checkShipmentTransition(head.status, to);
    if (denial) return problemResponse(c, new Problem(409, 'bad_transition', denial));

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update shipment set status = $2, version = version + 1, updated_at = now() where id = $1`,
        [id, to],
      );

      const lineStatus = SHIPMENT_STATES[to].lineStatus;
      const lines = lineStatus
        ? await client.query(
            `update line set status = $2, version = version + 1, updated_at = now()
              where shipment_doc_id = $1 and not deleted`,
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

addTransition('/shipments/{id}/ship', 'shipped', 'Отгрузить: товар покинул склад (M12)');
addTransition('/shipments/{id}/close', 'closed', 'Закрыть: документы проверены (M15)');

// --- DELETE /shipments/{id} — отмена отгрузки ----------------------------------------

shipmentsFlow.openapi(createRoute({
  method: 'delete',
  path: '/shipments/{id}',
  tags: ['shipments'],
  summary: 'Отменить отгрузку (мягкое удаление)',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Отгрузка отменена', content: { 'application/json': { schema: z.object({
      id: uuid, released: z.number().int(),
    }) } } },
    404: { description: 'Отгрузка не найдена' },
    409: { description: 'Закрытую отгрузку отменить нельзя' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  let head: ShipmentHead;
  try {
    head = await loadShipment(id);
  } catch (e) {
    if (e instanceof Problem) return problemResponse(c, e);
    throw e;
  }

  if (head.status === 'closed') {
    return problemResponse(c, new Problem(409, 'bad_transition',
      'Закрытую отгрузку отменить нельзя: документы уже проверены.'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    // Строки отвязываются и возвращаются в «Собрано»: товар остался на складе,
    // и отгрузить его можно заново.
    const lines = await client.query(
      `update line set shipment_doc_id = null, status = 'ready_to_ship',
                        version = version + 1, updated_at = now()
        where shipment_doc_id = $1 and not deleted`,
      [id],
    );
    await client.query(
      `update shipment set deleted_at = now(), version = version + 1 where id = $1`,
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
