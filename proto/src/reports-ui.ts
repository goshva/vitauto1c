import { Hono } from 'hono';
import { guard, roleOf } from './auth.ts';
import { isAllowed } from './domain/access.ts';
import { esc, layout } from './views/html.ts';
import { problemResponse } from './problem.ts';
import { byMonth, totals, totalsBy, type SaleRow } from './domain/reports.ts';
import { loadRepair, loadSales, loadStuck } from './reports-data.ts';
import {
  reportDenied, reportNote, stuckTable, totalsSummary, totalsTable,
} from './views/reports.ts';

// Экран отчётов: рентабельность и зависшие строки.
//
// ЧТО ЗДЕСЬ ВАЖНО, КРОМЕ ВЁРСТКИ.
//
// РАЗДЕЛ С СЕБЕСТОИМОСТЬЮ ВИДЕН ВСЕМ, НО ЗАКРЫТ НЕ ВСЕМ — И ЭТО НАПИСАНО СЛОВАМИ.
// Убрать раздел молча нельзя: человек решит, что отчёта нет или он сломан. Поэтому вкладка
// есть у всех, а внутри — причина отказа с названием права. Проверка при этом НА СЕРВЕРЕ:
// показ причины — вежливость, а не защита.
//
// ЭКРАН И API СЧИТАЮТ ОДНИМИ ФУНКЦИЯМИ. `totals` и `loadSales` — те же, что в
// `reports.ts`. Иначе экран показывал бы одно, а выгрузка отдавала другое, и веры не было
// бы ни одной из цифр.

export const reportsUi = new Hono();

/** Разделы отчёта. Порядок — порядок вкладок. */
const TABS = [
  { key: 'profitability', title: 'Рентабельность', needs: 'report.cost' },
  { key: 'repair', title: 'Ремонт', needs: 'report.cost' },
  { key: 'stuck', title: 'Зависшие строки', needs: 'request.view' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const isTab = (s: string | undefined): s is TabKey => TABS.some((t) => t.key === s);

/** Рентабельность: итог, разрезы и месяцы. Общее тело для продаж и ремонта. */
function totalsBody(rows: SaleRow[], note: string): string {
  // Расчёт отдаёт `key`, показ ждёт `label`: подпись — понятие ЭКРАНА, и расчёту
  // знать о ней нечего. Преобразование делаем здесь, а не в доменном модуле.
  const named = (g: { key: string; totals: ReturnType<typeof totals> }): { label: string; totals: ReturnType<typeof totals> } =>
    ({ label: g.key, totals: g.totals });

  const byNomenclature = totalsBy(rows, (r) => r.nomenclature, { limit: 20 }).map(named);
  const byCustomer = totalsBy(rows, (r) => r.customer, { limit: 20, sortBy: 'profit' }).map(named);
  const months = byMonth(rows).map(named);

  return `${totalsSummary(totals(rows))}
  ${reportNote(note)}
  <h3>По позициям</h3>
  ${totalsTable(byNomenclature, { label: 'Наименование', testId: 'by-nomenclature' })}
  <h3>По заказчикам</h3>
  ${totalsTable(byCustomer, { label: 'Заказчик', testId: 'by-customer' })}
  <h3>По месяцам</h3>
  <p class="hint">Месяцы без продаж не показаны: это отсутствие данных, а не спад.</p>
  ${totalsTable(months, { label: 'Месяц', testId: 'by-month' })}`;
}

/** Рентабельность продаж. */
async function profitability(c: { dateFrom?: string; dateTo?: string; groupBy?: string }): Promise<string> {
  const rows = await loadSales(c);

  // Строки без себестоимости: их выручка учтена, прибыль нет. Без этой оговорки цифру
  // принимают за полную — и решение примут по неполным данным.
  const withoutCost = rows.filter((r) => r.costPrice === null).length;
  return totalsBody(rows,
    'В расчёт вошли состоявшиеся продажи: отгруженные и не отменённые. '
    + 'Ремонт считается отдельным отчётом: у наряда своя дата признания.'
    + (withoutCost > 0
      ? ` Строк без себестоимости: ${withoutCost} — их выручка учтена, прибыль нет.`
      : ''));
}

/** Рентабельность ремонта: отдельный отчёт (решение заказчика 20.11.2026). */
async function repair(c: { dateFrom?: string; dateTo?: string; groupBy?: string }): Promise<string> {
  const rows = await loadRepair(c);
  const works = rows.filter((r) => r.kind === 'repair-labor').length;
  const parts = rows.filter((r) => r.kind === 'repair-part').length;

  return totalsBody(rows,
    `В расчёт вошли закрытые заказ-наряды: работы ${works} — по нормо-часам, `
    + `запчасти ${parts} — как продажа. Дата признания — дата закрытия наряда. `
    + 'Открытые наряды в отчёт не входят.');
}

/** Зависшие строки. */
async function stuck(days: number): Promise<string> {
  const rows = await loadStuck(days);
  return `<p class="hint" data-testid="stuck-note">
    Строки, стоящие на месте дольше ${days} дн. Закрытые и отменённые сюда не попадают:
    они закончены, а не стоят.
  </p>
  <p class="hint" data-testid="stuck-total">Зависших: <b>${rows.length}</b></p>
  ${stuckTable(rows)}`;
}

/** Панель отчёта целиком: вкладки, период и содержимое. */
export async function reportsPanel(params: {
  tab?: string;
  dateFrom?: string;
  dateTo?: string;
  days?: number;
  role: string;
}): Promise<string> {
  const tab: TabKey = isTab(params.tab) ? params.tab : 'profitability';
  const active = TABS.find((t) => t.key === tab)!;
  const allowed = isAllowed(params.role, active.needs);

  const tabs = TABS.map((t) => {
    const q = new URLSearchParams({ tab: t.key });
    if (params.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params.dateTo) q.set('dateTo', params.dateTo);
    // Раздел, закрытый роли, помечен прямо во вкладке: так видно, что он есть и почему
    // не открывается, — вместо молчаливого отсутствия.
    const locked = isAllowed(params.role, t.needs) ? '' : ' <span class="hint">(закрыт)</span>';
    return `<a href="/reports?${q.toString()}" data-testid="report-tab-${esc(t.key)}"${
      t.key === tab ? ' class="tab-active"' : ''}>${esc(t.title)}${locked}</a>`;
  }).join('');

  // Период показываем только тому, кто вправе видеть сам отчёт: пустая форма периода у
  // закрытого раздела выглядела бы как «вот-вот загрузится». У продаж и ремонта период
  // свой, но поле одно — и оно подписано тем, к чему относится.
  const withPeriod = active.key !== 'stuck';
  const form = withPeriod && allowed
    ? `<form class="filters" method="get" action="/reports" data-testid="report-period">
        <input type="hidden" name="tab" value="${esc(active.key)}">
        <div class="filters-row">
          <label class="f"><span>${active.key === 'repair'
            ? 'С даты закрытия наряда' : 'С даты отгрузки'}</span>
            <input type="date" name="dateFrom" data-testid="report-from"
                   value="${esc(params.dateFrom ?? '')}"></label>
          <label class="f"><span>По</span>
            <input type="date" name="dateTo" data-testid="report-to"
                   value="${esc(params.dateTo ?? '')}"></label>
        </div>
        <div class="filters-actions">
          <button type="submit" data-testid="report-apply">Показать</button>
          <a href="/reports?tab=${esc(active.key)}" data-testid="report-reset">Весь период</a>
        </div>
      </form>`
    : '';

  const body = !allowed
    ? reportDenied(active.title, active.needs)
    : active.key === 'profitability'
      ? await profitability(params)
      : active.key === 'repair'
        ? await repair(params)
        : await stuck(params.days ?? 3);

  return `<div id="reports-panel" data-testid="reports-panel" data-tab="${esc(tab)}">
  <nav class="tabs" data-testid="report-tabs">${tabs}</nav>
  ${form}
  ${body}
</div>`;
}

// --- GET /reports — экран -------------------------------------------------------------
reportsUi.get('/reports', async (c) => {
  const role = roleOf(c);

  // Хотя бы один раздел должен быть доступен: иначе показать нечего, и это надо сказать
  // отказом, а не пустой страницей.
  const anyAllowed = TABS.some((t) => isAllowed(role, t.needs));
  if (!anyAllowed) {
    const noRight = guard(c, 'request.view');
    if (noRight) return problemResponse(c, noRight);
  }

  const q = c.req.query();
  const days = Number(q.days ?? 3);

  return c.html(layout({
    title: 'Отчёты',
    testId: 'page-reports',
    active: 'reports',
    role,
    body: `<p class="hint" data-testid="reports-hint">
      Цифры считаются только по СОСТОЯВШИМСЯ продажам: отгруженные и не отменённые строки.
      Убыточные строки показаны отдельно и не скрываются — по отчёту принимают решения.
    </p>${await reportsPanel({
      tab: q.tab,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      days: Number.isFinite(days) && days > 0 ? days : 3,
      role,
    })}`,
  }));
});

