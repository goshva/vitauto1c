import { cell, esc, layout } from './html.ts';

// Печатные формы (решение заказчика Q4: переносим, серверный рендер).
//
// Три формы, как в legacy `arm/print.go`:
//   assembly_sheet       K3   «Сборочный лист» — без цен, с колонками сборки
//   shipment_sheet       M12  «Отгрузочная ведомость» — с ценами
//   shipment_correction  M19  «Корректировка отгрузочной ведомости» — с ценами
//
// Печать на СЕРВЕРЕ, а не на клиенте: форму надо уметь получить ссылкой
// (её печатают, сохраняют в PDF, отправляют), а не только из открытого АРМ.
// Playwright проверяет DOM — то же, что видит оператор на бумаге.

export interface PrintKind {
  /** Название формы на бланке. */
  title: string;
  /** Статусы строк, попадающих в форму. */
  statuses: string[];
  /** Показывать цены и суммы. */
  prices: boolean;
  /** Показывать колонки сборки («Собрано», «Дефект»). */
  assembly: boolean;
  /** Узел процесса — для трассировки к ТЗ. */
  node: string;
}

/**
 * Карта форм. Единственное место, где перечислены виды печати: в legacy их
 * список был в Go, а подписи — в шаблоне, и они расходились.
 *
 * Соответствие статусов legacy → прототип: `stAssembled`/`stPrepared` модель
 * свела в один `ready_to_ship` («Собрано»), поэтому в отгрузочной ведомости
 * два статуса, а не три.
 */
export const PRINT_KINDS: Record<string, PrintKind> = {
  assembly_sheet: {
    title: 'Сборочный лист', statuses: ['assembly', 'reserve'],
    prices: false, assembly: true, node: 'K3',
  },
  shipment_sheet: {
    title: 'Отгрузочная ведомость', statuses: ['ready_to_ship', 'shipped'],
    prices: true, assembly: false, node: 'M12',
  },
  shipment_correction: {
    title: 'Корректировка отгрузочной ведомости', statuses: ['return'],
    prices: true, assembly: false, node: 'M19',
  },
};

export interface PrintRow {
  stockCell: string | null;
  nomenclatureArticle: string | null;
  nomenclature: string | null;
  factName: string | null;
  batch: string | null;
  nomenclatureUnit: string | null;
  quantity: string | null;
  salePrice: string | null;
  saleSum: string | null;
  customer: string | null;
  internalOrderNumber: string | null;
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Сумма по колонке. Считается здесь, чтобы бланк и экран не расходились. */
const sum = (rows: PrintRow[], pick: (r: PrintRow) => unknown): number =>
  rows.reduce((acc, r) => acc + num(pick(r)), 0);

const money = (x: number): string =>
  x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const qty = (x: number): string => String(Number(x.toFixed(3)));

function header(kind: PrintKind, rows: PrintRow[]): string {
  const today = new Date().toLocaleDateString('ru-RU');
  const order = rows[0]?.internalOrderNumber;
  const customer = rows[0]?.customer;
  return `<header class="print-head">
    <h1 data-testid="print-title">${esc(kind.title)}</h1>
    <p class="print-meta">
      <span data-testid="print-date">${esc(today)}</span>
      · узел ${esc(kind.node)}
      ${order ? ` · заказ <span data-testid="print-order">${esc(order)}</span>` : ''}
      ${customer ? ` · <span data-testid="print-customer">${esc(customer)}</span>` : ''}
    </p>
  </header>`;
}

function headRow(kind: PrintKind): string {
  const assembly = kind.assembly ? '<th>Собрано</th><th>Дефект / недостача</th>' : '';
  const prices = kind.prices ? '<th class="c-num">Цена</th><th class="c-num">Сумма</th>' : '';
  return `<tr>
        <th class="c-num">№</th><th>Ячейка</th><th>Артикул</th><th>Наименование</th>
        <th>Партия</th><th>Ед.</th><th class="c-num">Кол-во</th>${assembly}${prices}
      </tr>`;
}

function bodyRow(kind: PrintKind, r: PrintRow, i: number): string {
  const assembly = kind.assembly ? '<td class="c-num"></td><td class="c-num"></td>' : '';
  const prices = kind.prices
    ? `<td class="c-num">${cell(money(num(r.salePrice)))}</td>` +
      `<td class="c-num">${cell(money(num(r.saleSum)))}</td>`
    : '';
  return `<tr data-testid="print-row-${i + 1}">
      <td class="c-num">${i + 1}</td>
      <td>${cell(r.stockCell)}</td>
      <td>${cell(r.nomenclatureArticle)}</td>
      <td>${cell(r.nomenclature ?? r.factName)}</td>
      <td>${cell(r.batch)}</td>
      <td>${cell(r.nomenclatureUnit)}</td>
      <td class="c-num" data-testid="print-qty-${i + 1}">${cell(qty(num(r.quantity)))}</td>
      ${assembly}${prices}
    </tr>`;
}

function footRow(kind: PrintKind, rows: PrintRow[]): string {
  const assembly = kind.assembly ? '<td></td><td></td>' : '';
  const prices = kind.prices
    ? `<td class="c-num">Итого</td>` +
      `<td class="c-num" data-testid="print-total">${cell(money(sum(rows, (r) => r.saleSum)))}</td>`
    : '';
  return `<tr>
        <td colspan="6" data-testid="print-count">Всего строк: ${rows.length}</td>
        <td class="c-num" data-testid="print-qty-total">${cell(qty(sum(rows, (r) => r.quantity)))}</td>
        ${assembly}${prices}
      </tr>`;
}

function table(kind: PrintKind, rows: PrintRow[]): string {
  return `<table class="print" data-testid="print-table">
    <thead>${headRow(kind)}</thead>
    <tbody>
${rows.map((r, i) => bodyRow(kind, r, i)).join('\n')}
    </tbody>
    <tfoot>${footRow(kind, rows)}</tfoot>
  </table>`;
}

/** Подписи: на бланке их три, как в legacy. */
function signs(): string {
  return `<footer class="print-signs" data-testid="print-signs">
    <div>Отгрузил ____________________</div>
    <div>Принял ____________________</div>
    <div>Проверил ____________________</div>
  </footer>`;
}

/** Форма целиком: HTML-страница, пригодная для печати. */
export function printPage(kindKey: string, kind: PrintKind, rows: PrintRow[]): string {
  return layout({
    title: kind.title,
    testId: `page-print-${kindKey}`,
    body: `<article class="print-sheet">
      ${header(kind, rows)}
      ${rows.length === 0 ? '<p data-testid="print-empty">Нет строк для этой формы</p>' : table(kind, rows)}
      ${signs()}
    </article>`,
  });
}
