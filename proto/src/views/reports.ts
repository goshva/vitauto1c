import { esc } from './html.ts';
import type { Totals } from '../domain/reports.ts';
import type { StuckRow } from '../reports-data.ts';

// Показ отчётов (волна 2, отчётность).
//
// ТРИ РЕШЕНИЯ, КОТОРЫЕ ЗДЕСЬ ВАЖНЕЕ ВЁРСТКИ.
//
// 1. УБЫТОК ВИДЕН И НЕ СПРЯТАН. Строка с отрицательной прибылью выделена и подписана —
//    отчёт, в котором убыточная продажа выглядит как обычная, опаснее отсутствующего: по
//    нему принимают решения. Модуль процента не берётся нигде.
//
// 2. ОГОВОРКА СТОИТ СВЕРХУ, А НЕ В ПОДВАЛЕ. В расчёт входят только состоявшиеся продажи,
//    и часть строк бывает без себестоимости. Без этой оговорки цифру принимают за полную
//    и решают по неполным данным.
//
// 3. ОТКАЗ ОБЪЯСНЯЕТСЯ, А НЕ ПРЯЧЕТСЯ. Роль без права на себестоимость не должна видеть
//    отчёт вообще — спрятать колонку бесполезно, итог её выдаст. Но и молча убрать раздел
//    нельзя: человек решит, что отчёт сломан или его нет. Поэтому раздел виден, а внутри —
//    причина отказа.

/** Наценка: пусто — делить нельзя было, себестоимость нулевая. */
function markupCell(t: Totals): string {
  if (t.markupPct === null) return '<span class="empty">—</span>';
  // Отрицательная наценка — это убыток, и она выделяется так же, как убыток в прибыли.
  const cls = t.markupPct < 0 ? ' class="report-loss"' : '';
  return `<span${cls}>${t.markupPct.toFixed(1)} %</span>`;
}

/** Прибыль: отрицательная выделяется и подписывается словом. */
function profitCell(t: Totals): string {
  if (t.profit < 0) {
    return `<span class="report-loss" data-testid="report-loss">${t.profit.toFixed(2)}</span>`;
  }
  return t.profit.toFixed(2);
}

function totalsCells(t: Totals): string {
  return `<td class="c-num">${t.lines}</td>
      <td class="c-num">${t.units}</td>
      <td class="c-num">${t.revenue.toFixed(2)}</td>
      <td class="c-num">${t.cost.toFixed(2)}</td>
      <td class="c-num">${profitCell(t)}</td>
      <td class="c-num">${markupCell(t)}</td>`;
}

/** Таблица итогов с разрезом. `title` — что за разрез: по позиции, заказчику, месяцу. */
export function totalsTable(rows: { label: string; totals: Totals }[], options: {
  label: string;
  testId: string;
  showUnits?: boolean;
}): string {
  if (rows.length === 0) {
    return `<p class="hint" data-testid="${esc(options.testId)}-empty">
      За выбранный период состоявшихся продаж нет. Отчёт пуст не из-за ошибки:
      в расчёт входят только отгруженные и не отменённые строки.
    </p>`;
  }

  const units = options.showUnits !== false ? '<th class="c-num">Штук</th>' : '';

  return `<table class="report" data-testid="${esc(options.testId)}">
  <thead><tr>
    <th>${esc(options.label)}</th><th class="c-num">Строк</th>${units}
    <th class="c-num">Выручка</th><th class="c-num">Себестоимость</th>
    <th class="c-num">Прибыль</th><th class="c-num">Наценка</th>
  </tr></thead>
  <tbody>
${rows.map((r) => `  <tr data-testid="${esc(options.testId)}-row">
    <td>${esc(r.label)}</td>
    ${totalsCells(r.totals)}
  </tr>`).join('\n')}
  </tbody>
</table>`;
}

/** Итоговая строка целиком: главная цифра отчёа. */
export function totalsSummary(t: Totals): string {
  if (t.lines === 0) {
    return `<p class="hint" data-testid="report-none">
      Состоявшихся продаж за период нет.
    </p>`;
  }

  return `<div class="report-total" data-testid="report-total">
  <div class="report-figure"><span class="dash-hint">Выручка</span>
    <strong data-testid="report-revenue">${t.revenue.toFixed(2)}</strong></div>
  <div class="report-figure"><span class="dash-hint">Себестоимость</span>
    <strong>${t.cost.toFixed(2)}</strong></div>
  <div class="report-figure"><span class="dash-hint">Прибыль</span>
    <strong${t.profit < 0 ? ' class="report-loss"' : ''}
      data-testid="report-profit">${t.profit.toFixed(2)}</strong></div>
  <div class="report-figure"><span class="dash-hint">Наценка</span>
    <strong data-testid="report-markup">${t.markupPct === null
      ? '—' : `${t.markupPct.toFixed(1)} %`}</strong></div>
  <div class="report-figure"><span class="dash-hint">Штук</span><strong>${t.units}</strong></div>
  ${
    t.lossLines > 0
      ? `<div class="report-figure"><span class="dash-hint">Ниже себестоимости</span>
           <strong class="report-loss" data-testid="report-loss-lines">${t.lossLines}</strong></div>`
      : ''
  }
</div>`;
}

/** Зависшие строки. */
export function stuckTable(rows: StuckRow[]): string {
  if (rows.length === 0) {
    return `<p class="hint" data-testid="stuck-empty">
      Зависших строк нет: ни одна не стоит дольше срока. Закрытые и отменённые сюда не
      попадают — они закончены, а не стоят.
    </p>`;
  }

  return `<table class="report" data-testid="stuck-table">
  <thead><tr>
    <th class="c-num">№</th><th>Заказчик</th><th>Наименование</th>
    <th>Состояние</th><th>Заявка</th><th class="c-num">Дней</th>
  </tr></thead>
  <tbody>
${rows.map((x) => `  <tr data-testid="stuck-row">
    <td class="c-num">${x.order ?? '—'}</td>
    <td>${esc(x.customer ?? '—')}</td>
    <td>${esc(x.nomenclature ?? '—')}</td>
    <td>${esc(x.status)}</td>
    <td class="c-nowrap">${esc(x.orderDate ?? '—')}</td>
    <td class="c-num report-loss">${x.daysStuck}</td>
  </tr>`).join('\n')}
  </tbody>
</table>`;
}

/** Оговорка к цифрам: что вошло в расчёт и что нет. */
export function reportNote(note: string): string {
  return `<p class="hint" data-testid="report-note">${esc(note)}</p>`;
}

/** Отказ с объяснением причины: раздел виден, а внутри — почему закрыт. */
export function reportDenied(what: string, needed: string): string {
  return `<p class="hint-partial" data-testid="report-denied">
    <b>${esc(what)}</b> недоступен: он показывает себестоимость и прибыль, а вашей роли
    они закрыты (ФТ v2 п. 5). Право: <code>${esc(needed)}</code>.
    Дело не в оформлении: в отчёте нельзя спрятать колонку — итог по ней всё равно
    покажет себестоимость. Поэтому раздел закрыт целиком.
  </p>`;
}
