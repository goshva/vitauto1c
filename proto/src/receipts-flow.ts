import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';

// Проведение приёмки (M12) и её отмена. Вынесено из `receipts.ts` (лимит 200 строк).
//
// Проведение — это момент, когда товар появляется на складе: создаются движения
// `stock_move`, из которых считается остаток. До проведения приёмка — бумага.

export const receiptsFlow = createApi();

interface ReceiptHead {
  id: string;
  number: string | null;
  posted: boolean;
  warehouse_id: string | null;
}

async function loadReceipt(id: string): Promise<ReceiptHead> {
  const r = await pool.query<ReceiptHead>(
    `select id, number, posted, warehouse_id from receipt where id = $1 and deleted_at is null`,
    [id],
  );
  if (r.rowCount === 0) throw new Problem(404, 'not_found', `Приёмка ${id} не найдена`);
  return r.rows[0]!;
}

// --- POST /receipts/{id}/post — провести: товар на склад (M12) -----------------------

receiptsFlow.openapi(createRoute({
  method: 'post',
  path: '/receipts/{id}/post',
  tags: ['warehouse'],
  summary: 'Провести приёмку: товар поступает на склад (M12)',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Приёмка проведена', content: { 'application/json': { schema: z.object({
      id: uuid, posted: z.boolean(), moved: z.number().int(), lines: z.number().int(),
    }) } } },
    404: { description: 'Приёмка не найдена' },
    409: { description: 'Уже проведена или нет строк' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  let head: ReceiptHead;
  try {
    head = await loadReceipt(id);
  } catch (e) {
    if (e instanceof Problem) return problemResponse(c, e);
    throw e;
  }

  if (head.posted) {
    return problemResponse(c, new Problem(409, 'already_posted',
      `Приёмка ${head.number} уже проведена: товар на складе. Повторное проведение удвоило бы остаток.`));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    const lines = await client.query<{ id: string; nomenclature_id: string | null; quantity: string | null; warehouse_id: string | null }>(
      `select id, nomenclature_id, quantity, $2::uuid as warehouse_id
         from line where receipt_id = $1 and not deleted`,
      [id, head.warehouse_id],
    );

    if (lines.rowCount === 0) {
      await client.query('rollback');
      return problemResponse(c, new Problem(409, 'nothing_marked',
        'В приёмке нет строк: проводить нечего.'));
    }

    let moved = 0;
    for (const line of lines.rows) {
      // Движение создаётся ТОЛЬКО для строки с номенклатурой: без неё остаток
      // не к чему привязать, и он «повис» бы в отчёте.
      if (!line.nomenclature_id) continue;
      await client.query(
        `insert into stock_move (nomenclature_id, warehouse_id, kind, quantity, line_id, comment)
         values ($1, $2, 'receipt', $3, $4, $5)`,
        [line.nomenclature_id, head.warehouse_id, line.quantity ?? 0, line.id,
          `Приёмка ${head.number}`],
      );
      moved++;
    }

    // Товар на складе, но ещё не разложен: размещение по ячейкам — отдельный шаг (K2).
    const updated = await client.query(
      `update line set status = 'to_stock', version = version + 1, updated_at = now()
        where receipt_id = $1 and not deleted`,
      [id],
    );
    await client.query(
      `update receipt set posted = true, version = version + 1, updated_at = now() where id = $1`,
      [id],
    );

    await client.query('commit');
    return c.json({ id, posted: true, moved, lines: updated.rowCount ?? 0 }, 200);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});

// --- DELETE /receipts/{id} — отмена приёмки ------------------------------------------

receiptsFlow.openapi(createRoute({
  method: 'delete',
  path: '/receipts/{id}',
  tags: ['warehouse'],
  summary: 'Отменить приёмку (мягкое удаление)',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'Приёмка отменена', content: { 'application/json': { schema: z.object({
      id: uuid, released: z.number().int(),
    }) } } },
    404: { description: 'Приёмка не найдена' },
    409: { description: 'Проведённую приёмку отменить нельзя' },
  },
}), async (c) => {
  const { id } = c.req.valid('param');

  let head: ReceiptHead;
  try {
    head = await loadReceipt(id);
  } catch (e) {
    if (e instanceof Problem) return problemResponse(c, e);
    throw e;
  }

  // Проведённую приёмку отменять нельзя: движения уже созданы, и остаток
  // на складе станет неверным. Сначала сторно, потом отмена — но сторно
  // в прототип не входит.
  if (head.posted) {
    return problemResponse(c, new Problem(409, 'already_posted',
      `Приёмка ${head.number} проведена: товар на складе. Отмена исказила бы остаток — ` +
      'сначала оформите возврат поставщику.'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    // Строки возвращаются в «Заказан»: товар ещё не принят, и его ждут.
    const lines = await client.query(
      `update line set receipt_id = null, status = 'ordered', version = version + 1, updated_at = now()
        where receipt_id = $1 and not deleted`,
      [id],
    );
    await client.query(
      `update receipt set deleted_at = now(), version = version + 1 where id = $1`,
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
