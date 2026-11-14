import { esc } from './html.ts';

// Экран склада: остатки по номенклатуре и местам хранения.
//
// Остаток НЕ хранится в строке — он вычисляется из движений (`stock_balance`).
// Поэтому экран показывает три числа: приход-расход (на складе), резерв и
// свободный остаток. Разница между «на складе» и «свободно» — это и есть ответ
// на вопрос кладовщика «можно ли выдать», и показывать одно число недостаточно.

export interface StockRow {
  nomenclatureId: string;
  nomenclature: string;
  article: string | null;
  warehouse: string | null;
  cell: string | null;
  onHand: string;
  reserved: string;
}

const num = (v: string): string =>
  Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 3 });

/** Свободно = на складе минус зарезервированное. Отрицательное — недостача. */
export const available = (r: StockRow): number => Number(r.onHand) - Number(r.reserved);

function row(r: StockRow, i: number): string {
  const free = available(r);
  return `<tr data-testid="stock-row-${i}" data-nomenclature="${esc(r.nomenclatureId)}">
  <td>${esc(r.nomenclature)}</td>
  <td class="c-code">${esc(r.article ?? '—')}</td>
  <td>${esc(r.warehouse ?? '—')}</td>
  <td class="c-code">${esc(r.cell ?? '—')}</td>
  <td class="c-num">${esc(num(r.onHand))}</td>
  <td class="c-num" data-testid="stock-reserved-${i}">${esc(num(r.reserved))}</td>
  <td class="c-num${free < 0 ? ' stock-negative' : ''}">${esc(num(String(free)))}</td>
</tr>`;
}

export function stockTable(rows: StockRow[]): string {
  if (rows.length === 0) {
    return `<p data-testid="stock-empty">Склад пуст. Проведите приёмку или заведите остаток движением.</p>`;
  }

  return `<table class="stock" data-testid="stock-table">
  <thead><tr>
    <th>Номенклатура</th><th>Артикул</th><th>Склад</th><th>Ячейка</th>
    <th class="c-num">На складе</th><th class="c-num">Резерв</th><th class="c-num">Свободно</th>
  </tr></thead>
  <tbody>
${rows.map(row).join('\n')}
  </tbody>
</table>`;
}

/** Сводка: сколько позиций и что зарезервировано. */
export function stockSummary(rows: StockRow[]): string {
  const reserved = rows.reduce((s, r) => s + Number(r.reserved), 0);
  const shortage = rows.filter((r) => available(r) < 0).length;

  return `<p class="hint" data-testid="stock-summary">
    Позиций: <strong>${rows.length}</strong> ·
    зарезервировано: <strong>${esc(num(String(reserved)))}</strong>${
      shortage ? ` · <strong class="stock-negative">недостача по ${shortage} поз.</strong>` : ''}
  </p>`;
}
