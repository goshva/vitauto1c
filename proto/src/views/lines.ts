import { cell, esc } from './html.ts';
import { statusTitle } from '../domain/status.ts';

// Таблица строк АРМ.
//
// Колонок в контракте 58; в прототипе показываем 12 ключевых — остальные доступны
// через API и `line_view`. Показывать 58 колонок в браузере без горизонтальной
// прокрутки невозможно, а прокрутка в 58 колонок не помогает оператору.
//
// Каждая строка несёт data-testid, по которому Playwright находит её без знания
// вёрстки: `row-{id}`, `status-{id}`, `mark-{id}`.

export interface Row {
  id: string;
  order: string | null;
  status: string;
  marked: boolean;
  nomenclature: string | null;
  factName: string | null;
  nomenclatureArticle: string | null;
  clientOrderNumber: string | null;
  quantity: string | null;
  stockQty: string;
  reserveQty: string;
  customer: string | null;
  salePrice: string | null;
  saleSum: string | null;
  comment: string | null;
}

function row(r: Row): string {
  const checked = r.marked ? ' checked' : '';
  return `<tr data-testid="row-${esc(r.id)}" data-id="${esc(r.id)}" data-status="${esc(r.status)}">
  <td class="c-mark">
    <input type="checkbox" data-testid="mark-${esc(r.id)}"${checked}
           hx-post="/ui/lines/${esc(r.id)}/toggle"
           hx-target="#lines-panel" hx-swap="outerHTML">
  </td>
  <td class="c-num">${cell(r.order)}</td>
  <td data-testid="status-${esc(r.id)}" class="c-status s-${esc(r.status)}">${esc(statusTitle(r.status))}</td>
  <td class="c-code" data-testid="client-number-${esc(r.id)}">${cell(r.clientOrderNumber)}</td>
  <td>${cell(r.factName ?? r.nomenclature)}</td>
  <td class="c-code">${cell(r.nomenclatureArticle)}</td>
  <td class="c-num">${cell(r.quantity)}</td>
  <td class="c-num" data-testid="stock-${esc(r.id)}">${cell(r.stockQty)}</td>
  <td class="c-num">${cell(r.reserveQty)}</td>
  <td>${cell(r.customer)}</td>
  <td class="c-num">${cell(r.salePrice)}</td>
  <td class="c-num">${cell(r.saleSum)}</td>
  <td class="c-comment">${cell(r.comment)}</td>
</tr>`;
}

/** Тело таблицы. Возвращается отдельно — HTMX подменяет только его. */
export function linesRows(rows: Row[]): string {
  if (rows.length === 0) {
    return `<tr><td colspan="13" class="empty-row" data-testid="no-rows">Строк нет</td></tr>`;
  }
  return rows.map(row).join('\n');
}

/** Таблица целиком, с заголовком. */
export function linesTable(rows: Row[], view: string): string {
  return `<table class="lines" data-testid="lines-table" data-view="${esc(view)}">
  <thead>
    <tr>
      <th class="c-mark"><span class="vh">Отметка</span></th>
      <th class="c-num">№</th>
      <th>Статус</th>
      <th>Заказ клиента</th>
      <th>Наименование</th>
      <th>Артикул</th>
      <th class="c-num">Кол-во</th>
      <th class="c-num">Остаток</th>
      <th class="c-num">Резерв</th>
      <th>Заказчик</th>
      <th class="c-num">Цена</th>
      <th class="c-num">Сумма</th>
      <th>Комментарий</th>
    </tr>
  </thead>
  <tbody id="lines-body" data-testid="lines-body">
${linesRows(rows)}
  </tbody>
</table>`;
}
