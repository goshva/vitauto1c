import { Hono } from 'hono';
import { pool } from './db.ts';
import { linesPanel } from './lines-ui.ts';
import { esc } from './views/html.ts';

// Складские действия АРМ: размещение в ячейку (K2) и перемещение между зонами.
// Вынесено из `lines-ui-actions.ts`: файл перевалил за 200 строк.
//
// Отдельно от остальных действий, потому что они про ДВИЖЕНИЕ ЗАКАЗА
// (задание, канбан, загрузка), а эти — про МЕСТО товара на складе.

export const linesUiWarehouse = new Hono();

const opOf = (v: unknown): string => (v === 'purchases' ? 'purchase' : 'sale');

/** Отмеченные строки в порядке обработки — так же, как их видит оператор. */
async function markedIds(): Promise<{ id: string; status: string }[]> {
  const r = await pool.query<{ id: string; status: string }>(
    `select l.id, l.status from line l
       join line_mark m on m.id = l.id and m.marked
      where not l.deleted
      order by l.order_date, l.id`,
  );
  return r.rows;
}

// --- K2: размещение отмеченных строк в ячейку -----------------------------------------

linesUiWarehouse.post('/ui/lines/zone', async (c) => {
  const form = await c.req.parseBody();
  const op = opOf(form.view);
  const zoneId = String(form.zoneId ?? '');

  const zone = await pool.query<{ code: string; name: string }>(
    `select code, name from warehouse_zone where id = $1 and deleted_at is null`, [zoneId],
  );
  if (zone.rowCount === 0) {
    return c.html(
      (await linesPanel(op)).replace(
        '<div id="actions"',
        '<p class="hint-partial" data-testid="zone-error">Зона не найдена</p><div id="actions"',
      ),
    );
  }

  // Ячейка подбирается сервером: первая свободная в целевой зоне. Оператор
  // выбирает ПОМЕЩЕНИЕ, а не ячейку — ячейка это уже деталь раскладки.
  const free = await pool.query<{ id: string }>(
    `select id from storage_cell where zone_id = $1 and not blocked and deleted_at is null
      order by code limit 1`,
    [zoneId],
  );

  for (const l of await markedIds()) {
    await pool.query(
      `update line set zone_id = $2, cell_id = $3, version = version + 1, updated_at = now()
        where id = $1`,
      [l.id, zoneId, free.rows[0]?.id ?? null],
    );
    await pool.query(`update line_mark set marked = false where id = $1`, [l.id]);
  }

  return c.html(await linesPanel(op));
});

linesUiWarehouse.post('/ui/lines/cell', async (c) => {
  const form = await c.req.parseBody();
  const op = opOf(form.view);
  const cellId = String(form.cellId ?? '');

  const cell = await pool.query<{ code: string; blocked: boolean }>(
    `select code, blocked from storage_cell where id = $1 and deleted_at is null`,
    [cellId],
  );

  if (cell.rowCount === 0 || cell.rows[0]!.blocked) {
    // Причину показываем рядом с панелью, а не молча ничего не делаем.
    const why = cell.rowCount === 0 ? 'Ячейка не найдена' : `Ячейка ${cell.rows[0]!.code} заблокирована`;
    return c.html(
      (await linesPanel(op)).replace(
        '<div id="actions"',
        `<p class="hint-partial" data-testid="cell-error">${esc(why)}</p><div id="actions"`,
      ),
    );
  }

  for (const l of await markedIds()) {
    await pool.query(
      `update line set cell_id = $2, version = version + 1, updated_at = now() where id = $1`,
      [l.id, cellId],
    );
    await pool.query(`update line_mark set marked = false where id = $1`, [l.id]);
  }

  return c.html(await linesPanel(op));
});
