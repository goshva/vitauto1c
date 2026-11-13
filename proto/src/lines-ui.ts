import { Hono } from 'hono';
import type { Context } from 'hono';
import { pool } from './db.ts';
import { layout } from './views/html.ts';
import { linesTable, type Row } from './views/lines.ts';
import { actionsPanel, type MarkedLine } from './views/actions.ts';
import { checkTransition, requiresSignedOriginal } from './domain/transition.ts';
import { Problem, problemResponse } from './problem.ts';

// Экраны АРМ на HTMX.
//
// ПОЧЕМУ `Accept`, а не отдельный префикс `/ui`: адрес `/lines` — это адрес экрана,
// и он должен остаться им. Браузер просит `text/html` и получает страницу,
// тест и агент просят JSON и получают данные. Один URL — два представления,
// дублирования маршрутов нет.
//
// Действия вынесены под `/ui/lines/*`: у них нет JSON-двойника, и смешивать их
// с API-маршрутами (`POST /lines/transition` уже занят JSON-версией) нельзя.

export const linesUi = new Hono();

/** Клиент просит HTML? HTMX всегда добавляет `HX-Request`. */
export function wantsHtml(c: Context): boolean {
  if (c.req.header('hx-request')) return true;
  return (c.req.header('accept') ?? '').includes('text/html');
}

const LIST_SQL = `
  select "id", "order", "status", "marked", "nomenclature", "factName", "nomenclatureArticle", "clientOrderNumber",
         "quantity", "stockQty", "reserveQty", "customer", "salePrice", "saleSum", "comment"
    from line_view
   where operation = $1
   order by "order"
   limit $2`;

async function loadRows(operation: string, limit = 100): Promise<Row[]> {
  const r = await pool.query<Row>(LIST_SQL, [operation, limit]);
  return r.rows;
}

async function loadMarked(): Promise<MarkedLine[]> {
  const r = await pool.query<MarkedLine>(
    `select id, status from line where id in (select id from line_mark where marked) and not deleted`,
  );
  return r.rows;
}

/** Панель целиком: действия + таблица. HTMX подменяет её после каждого действия. */
export async function linesPanel(operation: string): Promise<string> {
  const [rows, marked] = await Promise.all([loadRows(operation), loadMarked()]);
  return `<div id="lines-panel" data-testid="lines-panel">
  ${actionsPanel(marked)}
  ${linesTable(rows, operation)}
</div>`;
}

/** Страница целиком. */
async function linesPage(operation: string): Promise<string> {
  return layout({
    title: 'Строки заказов',
    testId: 'page-lines',
    body: `<details class="import" data-testid="import-panel">
      <summary>Загрузить лист клиента (N1 → M1)</summary>
      <form data-testid="import-form" hx-post="/ui/lines/import"
            hx-target="#lines-panel" hx-swap="outerHTML">
        <label>Наименование <input name="name" data-testid="import-name" required></label>
        <label>Артикул <input name="article" data-testid="import-article"></label>
        <label>Кол-во <input name="qty" data-testid="import-qty" size="4"></label>
        <label>Ед. <input name="unit" data-testid="import-unit" size="4" value="шт"></label>
        <label>№ заказа клиента <input name="clientNumber" data-testid="import-client-number"></label>
        <button type="submit" data-testid="import-submit">Создать заказ</button>
      </form>
    </details>
    <form class="filter" data-testid="view-filter">
      <label><input type="radio" name="view" value="sales" data-testid="view-sales"
        ${operation === 'sale' ? 'checked' : ''}
        hx-get="/ui/lines/panel" hx-vals='{"view":"sales"}' hx-target="#lines-panel" hx-swap="outerHTML"> Продажи</label>
      <label><input type="radio" name="view" value="purchases" data-testid="view-purchases"
        ${operation === 'purchase' ? 'checked' : ''}
        hx-get="/ui/lines/panel" hx-vals='{"view":"purchases"}' hx-target="#lines-panel" hx-swap="outerHTML"> Закупки</label>
    </form>
    ${await linesPanel(operation)}`,
  });
}

const operation = (view: string | undefined): string => (view === 'purchases' ? 'purchase' : 'sale');

// --- GET /lines/panel — фрагмент (обновление списка и фильтра) -------------------------
linesUi.get('/ui/lines/panel', async (c) => {
  const html = await linesPanel(operation(c.req.query('view')));
  return c.html(html);
});

// --- POST /lines/{id}/toggle — отметка переключателем ---------------------------------
linesUi.post('/ui/lines/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const exists = await pool.query(`select 1 from line where id = $1 and not deleted`, [id]);
  if (exists.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }
  // Переключаем: клик по флажку — это «перевернуть», а не «поставить true».
  await pool.query(
    `insert into line_mark (id, marked) values ($1, true)
     on conflict (id) do update set marked = not line_mark.marked`,
    [id],
  );
  return c.html(await linesPanel(operation(c.req.query('view'))));
});

// --- POST /ui/lines/transition — переход по отмеченным --------------------------------
linesUi.post('/ui/lines/transition', async (c) => {
  const form = await c.req.parseBody();
  const to = String(form.to ?? '');
  const op = operation(typeof form.view === 'string' ? form.view : undefined);

  const marked = await pool.query<{ id: string; status: string; signed_original: boolean; name: string }>(
    `select l.id, l.status, coalesce(l.signed_original, false) as signed_original,
            coalesce(f.fact_name, l.id::text) as name
       from line l
       join line_mark m on m.id = l.id and m.marked
       left join line_fact f on f.id = l.id
      where not l.deleted
      order by l.order_date, l.id`,
  );

  const skipped: string[] = [];
  for (const line of marked.rows) {
    const denial = checkTransition(to, line.status);
    if (denial) { skipped.push(denial); continue; }
    if (requiresSignedOriginal(to, line.status) && !line.signed_original) {
      skipped.push('не отмечено «Документ подписан оригинал»');
      continue;
    }
    await pool.query(
      `update line set status = $2, version = version + 1, updated_at = now() where id = $1`,
      [line.id, to],
    );
    await pool.query(`update line_mark set marked = false where id = $1`, [line.id]);
  }

  // Панель возвращается целиком: и список, и кнопки пересчитываются на сервере.
  return c.html(await linesPanel(op));
});

export { linesPage, wantsHtml as htmlRequested };
