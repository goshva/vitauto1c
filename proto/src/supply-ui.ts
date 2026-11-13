import { Hono } from 'hono';
import { pool } from './db.ts';
import { layout } from './views/html.ts';
import { linesTable, type Row } from './views/lines.ts';
import { actionsPanel, type MarkedLine } from './views/actions.ts';

// Экран снабжения (M7, P2, M9).
//
// Ссылка «Снабжение» была в навигации с самого начала, но страницы за ней не было —
// переход вёл в 404. Экран показывает строки, которые снабжение ведёт: от «Заказан»
// до «Собрано», — и те же кнопки канбана, что в списке.
//
// Отдельный экран нужен потому, что снабженец работает с другим срезом: ему не нужны
// «Новый» и «Закрыт», зато нужны все, кто в пути.

export const supplyUi = new Hono();

/** Статусы, которыми занимается снабжение. Порядок — по движению товара. */
const SUPPLY_STATUSES = [
  'ordered', 'paid', 'in_transit', 'acceptance', 'to_stock', 'assembly', 'ready_to_ship',
];

async function loadRows(): Promise<Row[]> {
  const r = await pool.query<Row>(
    `select "id", "order", "status", "marked", "nomenclature", "factName", "nomenclatureArticle",
            "clientOrderNumber", "quantity", "stockQty", "reserveQty", "customer",
            "salePrice", "saleSum", "comment"
       from line_view
      where status = any($1)
      order by "order"`,
    [SUPPLY_STATUSES],
  );
  return r.rows;
}

async function loadMarked(): Promise<MarkedLine[]> {
  const r = await pool.query<MarkedLine>(
    `select id, status from line where id in (select id from line_mark where marked) and not deleted`,
  );
  return r.rows;
}

async function supplyPanel(): Promise<string> {
  const [rows, marked] = await Promise.all([loadRows(), loadMarked()]);
  return `<div id="lines-panel" data-testid="supply-panel">
  ${actionsPanel(marked)}
  ${rows.length === 0
    ? '<p data-testid="supply-empty">Строк в снабжении нет</p>'
    : linesTable(rows, 'supply')}
</div>`;
}

supplyUi.get('/supply', async (c) =>
  c.html(
    layout({
      title: 'Снабжение',
      testId: 'page-supply',
      body: `<p class="hint" data-testid="supply-hint">
        Строки от «Заказан» до «Собрано». Отметьте строки и переведите их по цепочке.
      </p>${await supplyPanel()}`,
    }),
  ),
);

// Кнопки канбана возвращают панель снабжения, а не список продаж: иначе после
// действия оператора выбрасывало бы на другой экран.
supplyUi.get('/ui/supply/panel', async (c) => c.html(await supplyPanel()));
