import { cell, esc } from './html.ts';
import { statusTitle } from '../domain/status.ts';
import { isHidden } from '../domain/columns.ts';

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

function row(r: Row, showPrices = true): string {
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
  <td data-filter="number" class="c-num">${cell(r.order)}</td>
  <td data-filter="status" data-testid="status-${esc(r.id)}" class="c-status"><span class="s-${esc(r.status)}">${esc(statusTitle(r.status))}</span></td>
  <td data-filter="urgency" class="c-flag" data-testid="urgency-${esc(r.id)}">${r.urgency ? esc(r.urgency) : '<span class="empty">—</span>'}</td>
  <td data-filter="clientNumber" class="c-code" data-testid="client-number-${esc(r.id)}">${cell(r.clientOrderNumber)}</td>
  <td data-filter="name">${cell(r.factName ?? r.nomenclature)}</td>
  <td data-filter="article" class="c-code">${cell(r.nomenclatureArticle)}</td>
  ${offerCell(r)}
  <td data-filter="qtyFrom" class="c-num">${cell(r.quantity)}</td>
  <td class="c-num" data-testid="stock-${esc(r.id)}">${cell(r.stockQty)}</td>
  <td class="c-num">${cell(r.reserveQty)}</td>
  <td data-filter="customer">${cell(r.customer)}</td>
  ${showPrices ? `<td class="c-num">${cell(r.salePrice)}</td>
  <td class="c-num">${cell(r.saleSum)}</td>` : ''}
  <td data-filter="comment" class="c-comment">${cell(r.comment)}</td>
</tr>`;
}

/** Тело таблицы. Возвращается отдельно — HTMX подменяет только его. */
export function linesRows(rows: Row[], showPrices = true): string {
  if (rows.length === 0) {
    // Число колонок в пустой строке обязано совпасть с заголовком, иначе таблица поедет.
    return `<tr><td colspan="${showPrices ? 15 : 13}" class="empty-row" data-testid="no-rows">Строк нет</td></tr>`;
  }
  return rows.map((r) => row(r, showPrices)).join('\n');
}

/**
 * Таблица целиком, с заголовком.
 *
 * ЦЕНЫ ПОКАЗЫВАЮТСЯ НЕ ВСЕМ. Раньше колонки «Цена» и «Сумма» рисовались любой роли: API
 * значения не отдавал, но КОЛОНКА НА ЭКРАНЕ БЫЛА — оператор видел, что данные существуют, и
 * искал, почему они пусты. Это и есть «видит то, что не должен».
 *
 * Правило берётся из ТОЙ ЖЕ функции `isHidden`, что и в API. Один источник — иначе экран и
 * выгрузка разойдутся, и веры не будет ни одной.
 */
export function linesTable(rows: Row[], view: string, role = 'admin'): string {
  // Показывать ли цены: спрашиваем у правила по КОЛОНКЕ, а не у роли напрямую.
  const showPrices = !isHidden(role, 'salePrice');
  const priceHead = showPrices
    ? '<th class="c-num">Цена</th>\n      <th class="c-num">Сумма</th>\n      '
    : '';

  return `<table class="lines" data-testid="lines-table" data-view="${esc(view)}" data-role="${esc(role)}">
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
      ${priceHead}<th>Комментарий</th>
    </tr>
  </thead>
  <tbody id="lines-body" data-testid="lines-body">
${linesRows(rows, showPrices)}
  </tbody>
</table>`;
}
