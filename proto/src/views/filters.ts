import { esc } from './html.ts';
import { STATUS_TITLES } from '../domain/status.ts';

// Панель отбора по КАЖДОМУ полю (ФТ v2 п. 14).
//
// «Панель отбора по каждому полю сверху» — значит сверху и на всех полях списка,
// а не на трёх избранных. Оператор ищет по тому, что у него на бумаге: номер
// заказа, гос. номер, «база», комментарий. Если поля в панели нет, он идёт
// просматривать список глазами.
//
// Форма стоит ВНЕ области подмены (`#lines-panel`): тогда после отбора введённые
// значения остаются на месте. Обнови мы её вместе со списком — оператор терял бы
// то, что набрал.

export interface FilterValues {
  status?: string;
  number?: string;
  name?: string;
  article?: string;
  clientNumber?: string;
  customer?: string;
  supplier?: string;
  urgency?: string;
  base?: string;
  plate?: string;
  comment?: string;
  dateFrom?: string;
  dateTo?: string;
  qtyFrom?: number;
  qtyTo?: number;
  marked?: string;
}

/** Поля панели: имя, подпись, ширина. Порядок — как в реестре заказчика. */
const FIELDS: { name: keyof FilterValues; label: string; wide?: boolean }[] = [
  { name: 'number', label: '№' },
  { name: 'clientNumber', label: 'Заказ клиента' },
  { name: 'name', label: 'Наименование', wide: true },
  { name: 'article', label: 'Артикул' },
  { name: 'customer', label: 'Заказчик' },
  { name: 'supplier', label: 'Поставщик' },
  { name: 'base', label: 'База' },
  { name: 'plate', label: 'Гос. номер' },
  { name: 'urgency', label: 'Срочно' },
  { name: 'qtyFrom', label: 'Кол-во от' },
  { name: 'qtyTo', label: 'до' },
  { name: 'dateFrom', label: 'Дата с' },
  { name: 'dateTo', label: 'по' },
  { name: 'comment', label: 'Комментарий', wide: true },
];

export function filtersPanel(v: FilterValues, options: {
  operation: string;
  /** Сколько условий задано — показываем, чтобы «пустой список» не выглядел поломкой. */
  active: number;
}): string {
  const inputs = FIELDS.map((f) => {
    const value = v[f.name];
    const type = f.name === 'dateFrom' || f.name === 'dateTo' ? 'date'
      : f.name === 'qtyFrom' || f.name === 'qtyTo' ? 'number' : 'text';
    return `<label class="f${f.wide ? ' wide' : ''}">
        <span>${esc(f.label)}</span>
        <input type="${type}" name="${f.name}" data-testid="filter-${f.name}"
               value="${esc(value ?? '')}"${
      f.name === 'qtyFrom' || f.name === 'qtyTo' ? ' step="any"' : ''}>
      </label>`;
  }).join('\n      ');

  const statuses = Object.entries(STATUS_TITLES)
    .map(([code, title]) => `<option value="${esc(code)}"${
      v.status === code ? ' selected' : ''}>${esc(title)}</option>`).join('\n        ');

  return `<form class="filters" data-testid="filters-panel"
      hx-get="/ui/lines/panel" hx-target="#lines-panel" hx-swap="outerHTML"
      hx-trigger="change, submit, keyup[key=='Enter'] from:find input">
    <input type="hidden" name="view" value="${esc(options.operation)}">

    <div class="filters-row">
      <label class="f">
        <span>Состояние</span>
        <select name="status" data-testid="filter-status">
          <option value="">все</option>
          ${statuses}
        </select>
      </label>
      <label class="f">
        <span>Отметка</span>
        <select name="marked" data-testid="filter-marked">
          <option value="">все</option>
          <option value="true"${v.marked === 'true' ? ' selected' : ''}>только отмеченные</option>
          <option value="false"${v.marked === 'false' ? ' selected' : ''}>без отметки</option>
        </select>
      </label>
      ${inputs}
    </div>

    <div class="filters-actions">
      <button type="submit" data-testid="filters-apply">Показать</button>
      <a href="/lines" data-testid="filters-reset">Сбросить</a>
      <span class="hint" data-testid="filters-active">${
        options.active === 0 ? 'Отбор не задан' : `Условий: ${options.active}`}</span>
    </div>
  </form>`;
}
