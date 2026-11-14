import { Hono } from 'hono';
import { pool } from './db.ts';
import { layout } from './views/html.ts';
import { stockSummary, stockTable, type StockRow } from './views/stock.ts';

// Экран склада (1 маршрут). Домашний экран кладовщика (Q7).
//
// Показывает остатки по движениям, а не по денормализованному полю: в legacy
// остаток лежал в четырёх столбцах строки и расходился с движениями. Здесь
// источник один — `stock_move`, и экран лишь читает представление.

export const stockUi = new Hono();

/** Остатки по номенклатуре и местам хранения. Нулевые не показываем — их много. */
async function loadStock(): Promise<StockRow[]> {
  const r = await pool.query<{
    nomenclature_id: string; nomenclature: string; article: string | null;
    warehouse: string | null; cell: string | null; on_hand: string; reserved: string;
  }>(
    `select sb.nomenclature_id, n.name as nomenclature, n.article,
            w.name as warehouse, c.code as cell,
            sb.on_hand::text, sb.reserved::text
       from stock_balance sb
       join nomenclature n on n.id = sb.nomenclature_id and n.deleted_at is null
       left join warehouse w on w.id = sb.warehouse_id
       left join storage_cell c on c.id = sb.cell_id
      where sb.on_hand <> 0 or sb.reserved <> 0
      order by n.name, c.code`,
  );

  return r.rows.map((x) => ({
    nomenclatureId: x.nomenclature_id, nomenclature: x.nomenclature, article: x.article,
    warehouse: x.warehouse, cell: x.cell, onHand: x.on_hand, reserved: x.reserved,
  }));
}

stockUi.get('/stock', async (c) => {
  const rows = await loadStock();

  return c.html(layout({
    active: 'stock',
    title: 'Склад',
    testId: 'page-stock',
    body: `${stockSummary(rows)}
    ${stockTable(rows)}
    <p class="hint">Приход, выдача и списание — движениями.
      Списание по заказ-наряду делается автоматически при его закрытии.
      <a href="/documents/returns">Возвраты</a> · <a href="/fleet">Автопарк</a></p>`,
  }));
});
