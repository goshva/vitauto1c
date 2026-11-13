import { allowedFrom, TRANSITIONS, type Transition } from '../domain/transition.ts';
import { esc } from './html.ts';

// Панель действий. Кнопки строятся из ТОЙ ЖЕ таблицы, что проверяет API
// (`src/domain/transition.ts`) — поэтому кнопка не может появиться там, где
// переход запрещён. Именно этого не хватало в legacy: таблица была продублирована
// четырежды, и кнопка `reserve` показывалась для `partially_ordered`, а бэкенд
// строку молча пропускал (C21).
//
// При смешанных статусах показываем ПЕРЕСЕЧЕНИЕ: кнопка работает только если
// переход допустим для всех отмеченных строк. Иначе оператор нажал бы кнопку
// и получил «обработано 0».

export interface MarkedLine {
  id: string;
  status: string;
}

/** Человеческое объяснение, почему кнопки нет. */
function hint(lines: MarkedLine[]): string {
  if (lines.length === 0) return 'Отметьте строки в списке';
  const statuses = [...new Set(lines.map((l) => l.status))];
  return statuses.length === 1
    ? `Отмечено: ${lines.length} · статус «${statuses[0]}»`
    : `Отмечено: ${lines.length} · статусы: ${statuses.join(', ')}`;
}

/** Переходы, допустимые для ВСЕХ отмеченных строк. */
export function commonTransitions(lines: MarkedLine[]): Transition[] {
  if (lines.length === 0) return [];
  const first = allowedFrom(lines[0]!.status).map((t) => t.to);
  return TRANSITIONS.filter(
    (t) => first.includes(t.to) && lines.every((l) => t.from.includes(l.status as never)),
  );
}

/** Переходы, допустимые лишь для части отмеченных строк — их кнопок не будет. */
export function partialTransitions(lines: MarkedLine[]): { transition: Transition; count: number }[] {
  if (lines.length === 0) return [];
  const common = new Set(commonTransitions(lines).map((t) => t.to));
  return TRANSITIONS.filter((t) => !common.has(t.to))
    .map((t) => ({ transition: t, count: lines.filter((l) => t.from.includes(l.status as never)).length }))
    .filter((x) => x.count > 0);
}

export function actionsPanel(lines: MarkedLine[]): string {
  const common = commonTransitions(lines);
  const partial = partialTransitions(lines);

  const buttons = common
    .map(
      (t) => `<button type="button" data-testid="action-${esc(t.to)}"
        hx-post="/ui/lines/transition" hx-vals='{"to":"${esc(t.to)}"}'
        hx-target="#lines-panel" hx-swap="outerHTML"
        title="Узел ${esc(t.node)}">${esc(t.title)}</button>`,
    )
    .join('\n      ');

  const note = partial.length
    ? `<p class="hint-partial" data-testid="partial-note">Недоступно для части строк: ${partial
        .map((x) => `${esc(x.transition.title)} (${x.count})`)
        .join(', ')}</p>`
    : '';

  return `<div id="actions" data-testid="actions-panel" data-count="${lines.length}">
  <span class="marked-count" data-testid="mark-count">${lines.length}</span>
  <span class="hint" data-testid="actions-hint">${esc(hint(lines))}</span>
  <span class="buttons">
      ${buttons}
  </span>
  ${note}
${chainPanel(lines)}
</div>`;
}

/**
 * Действия цепочки, которые в legacy жили в 1С или в отдельных формах:
 * задание «В работе» (M4), канбан снабжения (M7, P2) и размещение в ячейку (K2).
 *
 * Все три доступны из одного места: оператор не должен искать, в какой форме
 * какое действие. Кнопки канбана активны всегда — сервер сам решит, какие строки
 * подходят, и вернёт причину по остальным.
 */
function chainPanel(lines: MarkedLine[]): string {
  const has = lines.length > 0 ? '' : ' disabled';

  const job = `<button type="button" data-testid="chain-job"${has}
      hx-post="/ui/lines/job" hx-target="#lines-panel" hx-swap="outerHTML">В работе (M4)</button>`;

  const supply = SUPPLY_BUTTONS.map(
    (s) => `<button type="button" data-testid="chain-supply-${esc(s.code)}"${has}
      hx-post="/ui/lines/supply" hx-vals='{"status":"${esc(s.code)}"}'
      hx-target="#lines-panel" hx-swap="outerHTML">${esc(s.title)}</button>`,
  ).join('\n      ');

  const cell = `<select name="cellId" data-testid="chain-cell-select">
        ${CELLS.map((c) => `<option value="${esc(c.id)}">${esc(c.code)}</option>`).join('\n        ')}
      </select>
      <button type="button" data-testid="chain-cell"${has}
        hx-post="/ui/lines/cell" hx-include="[name='cellId']"
        hx-target="#lines-panel" hx-swap="outerHTML">Разместить (K2)</button>`;

  // Перемещение между ЗОНАМИ: ячейку сервер подбирает сам. Оператор выбирает
  // помещение («после ремонта — на склад», «брак — поставщику»), а не полку.
  const zone = `<select name="zoneId" data-testid="chain-zone-select">
        ${ZONES.map((z) => `<option value="${esc(z.id)}">${esc(z.title)}</option>`).join('\n        ')}
      </select>
      <button type="button" data-testid="chain-zone"${has}
        hx-post="/ui/lines/zone" hx-include="[name='zoneId']"
        hx-target="#lines-panel" hx-swap="outerHTML">Переместить</button>`;

  // Печатные формы — обычные ссылки, а не HTMX: бланк открывают в новой вкладке
  // и печатают, а не подставляют в текущую страницу.
  const printLinks = PRINT_FORMS.map(
    (f) => `<a href="/print/${esc(f.kind)}" target="_blank" rel="noopener"
      data-testid="print-${esc(f.kind)}">${esc(f.title)}</a>`,
  ).join('\n    ');

  return `  <div class="chain" data-testid="chain-panel">
    <span class="chain-label">Цепочка:</span>
    ${job}
    ${supply}
    <span class="chain-cell">${cell}</span>
    <span class="chain-cell">${zone}</span>
  </div>
  <div class="chain print-links" data-testid="print-panel">
    <span class="chain-label">Печать:</span>
    ${printLinks}
  </div>`;
}

/** Печатные формы (решение Q4). Подписи совпадают с заголовками бланков. */
const PRINT_FORMS = [
  { kind: 'assembly_sheet', title: 'Сборочный лист' },
  { kind: 'shipment_sheet', title: 'Отгрузочная ведомость' },
  { kind: 'shipment_correction', title: 'Корректировка ведомости' },
];


/** Кнопки канбана снабжения — порядок соответствует движению товара. */
const SUPPLY_BUTTONS = [
  { code: 'paid', title: 'Оплачен (M7)' },
  { code: 'in_transit', title: 'В пути (P2)' },
  { code: 'acceptance', title: 'Приёмка (K1)' },
  { code: 'assembly', title: 'Комплектация (M9)' },
  { code: 'assembled', title: 'Собрано (K3)' },
];

/**
 * Зоны склада для перемещения.
 *
 * Список статический (12 зон из модели, они не меняются в работе). Дублирование
 * сида намеренное: представление не должно ходить в базу за константой. Что список
 * не разошёлся с сидом, проверяет тест `zones.test.ts` — он сверяет `GET /zones`
 * со списком зон модели.
 */
const ZONES = [
  { id: '99999999-9999-9999-9999-999999999902', title: 'Малый склад' },
  { id: '99999999-9999-9999-9999-999999999903', title: 'Большой склад' },
  { id: '99999999-9999-9999-9999-999999999908', title: 'Резерв / Комплектация' },
  { id: '99999999-9999-9999-9999-999999999907', title: 'Укомплектованные' },
  { id: '99999999-9999-9999-9999-999999999909', title: 'Отгрузка клиенту / ТК' },
  { id: '99999999-9999-9999-9999-999999999906', title: 'Ремонтная зона' },
  { id: '99999999-9999-9999-9999-999999999912', title: 'Списание по ЗН' },
  { id: '99999999-9999-9999-9999-999999999911', title: 'Возврат поставщику' },
  { id: '99999999-9999-9999-9999-999999999904', title: 'Неопознанные' },
  { id: '99999999-9999-9999-9999-999999999910', title: 'Админ: опознание' },
  { id: '99999999-9999-9999-9999-999999999905', title: 'Возвраты' },
  { id: '99999999-9999-9999-9999-999999999901', title: 'Приёмка' },
];

/** Ячейки для размещения. Статический список: их семь и он не меняется в работе. */
const CELLS = [
  { id: '88888888-8888-8888-8888-888888888802', code: 'A-01' },
  { id: '88888888-8888-8888-8888-888888888803', code: 'A-02' },
  { id: '88888888-8888-8888-8888-888888888801', code: 'P-01' },
  { id: '88888888-8888-8888-8888-888888888806', code: 'R-01' },
  { id: '88888888-8888-8888-8888-888888888807', code: 'M-01' },
  { id: '88888888-8888-8888-8888-888888888808', code: 'S-01' },
];
