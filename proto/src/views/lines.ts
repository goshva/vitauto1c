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
  /** Метка «Срочно» (ФТ v2 п. 9). */
  urgency: string | null;
  /**
   * Варианты поставки (ФТ v2 п. 12). Пусто — выбирать не из чего: либо у позиции
   * одно предложение, либо она ещё не опознана.
   */
  offers: SupplyOffer[] | null;
  /** Выбранный вариант, если снабженец уже выбрал. */
  chosenOffer: string | null;
}

/** Вариант поставки: у кого, по какой цене и в какой срок. */
interface SupplyOffer {
  id: string;
  supplier: string;
  price: string;
  days: number | null;
}

/**
 * Подпись срока: ноль — «со склада», пусто — «срок не указан».
 *
 * Разница настоящая: ноль — это «забрать сегодня», а NULL — «продавец не назвал
 * срок». Показать их одинаково значило бы выдать неизвестное за быстрое.
 */
const daysLabel = (days: number | null): string =>
  days === null ? 'срок не указан' : days === 0 ? 'со склада' : `${days} дн.`;

/**
 * Поле выбора варианта — В САМОЙ СТРОКЕ, как требует ФТ.
 *
 * Показываем его только когда есть из чего выбирать (два предложения и больше):
 * выпадающий список с единственным пунктом выглядит как выбор, которого нет.
 * Когда выбор уже сделан — видно, какой именно: цена и срок написаны рядом, потому
 * что «выбрал АвтооптТорг» без цены ничего не решает.
 */
function offerCell(r: Row): string {
  const offers = r.offers ?? [];
  if (offers.length === 0) return '<td class="c-offer"></td>';

  if (offers.length === 1) {
    const o = offers[0]!;
    return `<td class="c-offer" data-testid="offer-single-${esc(r.id)}">
      <span class="offer-one">${esc(o.supplier)} · ${esc(o.price)} ₽ · ${esc(daysLabel(o.days))}</span>
    </td>`;
  }

  const options = offers.map((o) => `<option value="${esc(o.id)}"${
    o.id === r.chosenOffer ? ' selected' : ''}>${esc(o.supplier)} · ${esc(o.price)} ₽ · ${
    esc(daysLabel(o.days))}</option>`).join('\n          ');

  return `<td class="c-offer">
    <select data-testid="offer-${esc(r.id)}"
            hx-post="/ui/lines/${esc(r.id)}/offer"
            hx-include="this" hx-target="#lines-panel" hx-swap="outerHTML"
            name="offerId">
      <option value="">— выберите —</option>
      ${options}
    </select>
  </td>`;
}

function row(r: Row): string {
  const checked = r.marked ? ' checked' : '';
  // Срочность — ТОЛЬКО МЕТКА (ФТ v2 п. 9): подсвечивает строку цветом, но НЕ меняет
  // порядок формирования заказа поставщику. Порядок задаёт `order`, и путать эти
  // вещи нельзя: иначе «срочные» начнут обгонять уже оплаченные.
  const urgent = r.urgency ? ' row-urgent' : '';
  return `<tr class="line-row${urgent}" data-testid="row-${esc(r.id)}" data-id="${esc(r.id)}" data-status="${esc(r.status)}"${
    r.urgency ? ` data-urgency="${esc(r.urgency)}"` : ''}>
  <td class="c-mark">
    <input type="checkbox" data-testid="mark-${esc(r.id)}"${checked}
           hx-post="/ui/lines/${esc(r.id)}/toggle"
           hx-target="#lines-panel" hx-swap="outerHTML">
  </td>
  <td class="c-num">${cell(r.order)}</td>
  <td data-testid="status-${esc(r.id)}" class="c-status s-${esc(r.status)}">${esc(statusTitle(r.status))}</td>
  <td data-testid="urgency-${esc(r.id)}">${
    r.urgency ? `<span class="chip warn">Срочно</span>` : ''}</td>
  <td class="c-code" data-testid="client-number-${esc(r.id)}">${cell(r.clientOrderNumber)}</td>
  <td>${cell(r.factName ?? r.nomenclature)}</td>
  <td class="c-code">${cell(r.nomenclatureArticle)}</td>
  ${offerCell(r)}
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
      <th>Срочно</th>
      <th>Заказ клиента</th>
      <th>Наименование</th>
      <th>Артикул</th>
      <th>Поставка</th>
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
