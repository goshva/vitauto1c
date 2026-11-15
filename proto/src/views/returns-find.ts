import { esc } from './html.ts';

// Экран подбора проданного для возврата без документов (БТ п. 18).
//
// Отбор стоит СВЕРХУ и вне области подмены — как в списке строк: оператор вводит
// признаки, список обновляется, набранное остаётся.
//
// Кнопка «Оформить возврат» появляется только когда что-то отмечено: кнопка,
// которая ничего не делает, приучает не читать сообщения.

export interface FoundLine {
  id: string;
  order: number;
  name: string;
  article: string | null;
  customer: string | null;
  plate: string | null;
  /** Дата отгрузки, уже отформатированная. */
  shippedAt: string | null;
  quantity: string | null;
  status: string;
}

export interface FindValues {
  plate?: string;
  name?: string;
  article?: string;
  customer?: string;
  dateFrom?: string;
  dateTo?: string;
}

const FIELDS: { name: keyof FindValues; label: string; hint?: string }[] = [
  { name: 'plate', label: 'Гос. номер', hint: 'машина, с которой сняли' },
  { name: 'name', label: 'Наименование' },
  { name: 'article', label: 'Артикул' },
  { name: 'customer', label: 'Заказчик' },
  { name: 'dateFrom', label: 'Отгружено с' },
  { name: 'dateTo', label: 'по' },
];

function rows(items: FoundLine[]): string {
  if (items.length === 0) {
    return `<p class="hint" data-testid="find-empty">
      Ничего не найдено. Проверьте гос. номер и артикул — или расширьте период.
      Если деталь <em>не продавалась</em>, возврат от клиента по ней не оформить:
      в базе нет строки, к которой его привязать.
    </p>`;
  }

  return `<table class="found" data-testid="find-table">
  <thead><tr>
    <th class="c-mark"><span class="vh">Отметка</span></th>
    <th>№</th><th>Наименование</th><th>Артикул</th>
    <th>Заказчик</th><th>Гос. номер</th><th>Отгружено</th><th class="c-num">Кол-во</th>
  </tr></thead>
  <tbody>
${items.map((x) => `  <tr data-testid="found-${esc(x.id)}">
    <td class="c-mark">
      <input type="checkbox" name="lineId" value="${esc(x.id)}"
             data-testid="found-mark-${esc(x.id)}" form="return-form">
    </td>
    <td class="c-num">${x.order}</td>
    <td>${esc(x.name)}</td>
    <td class="c-code">${esc(x.article ?? '—')}</td>
    <td>${esc(x.customer ?? '—')}</td>
    <td class="c-code">${esc(x.plate ?? '—')}</td>
    <td>${esc(x.shippedAt ?? '—')}</td>
    <td class="c-num">${esc(x.quantity ?? '—')}</td>
  </tr>`).join('\n')}
  </tbody>
</table>
<form id="return-form" data-testid="find-return-form"
      hx-post="/ui/returns/from-found" hx-include="#return-form"
      hx-target="#find-panel" hx-swap="outerHTML">
  <button type="submit" data-testid="find-return-submit">Оформить возврат клиента</button>
  <span class="hint">Отметьте детали, которые клиент принёс.</span>
</form>`;
}

export function returnsFindPanel(items: FoundLine[], v: FindValues): string {
  const inputs = FIELDS.map((f) => {
    const type = f.name === 'dateFrom' || f.name === 'dateTo' ? 'date' : 'text';
    return `<label class="f">
      <span>${esc(f.label)}</span>
      <input type="${type}" name="${f.name}" data-testid="find-${f.name}"
             value="${esc(v[f.name] ?? '')}"${f.hint ? ` title="${esc(f.hint)}"` : ''}>
    </label>`;
  }).join('\n    ');

  return `<div id="find-panel" data-testid="find-panel" data-found="${items.length}">
  <form class="filters" data-testid="find-form"
        hx-get="/ui/returns/find" hx-target="#find-panel" hx-swap="outerHTML"
        hx-trigger="change, submit, keyup[key=='Enter'] from:find input">
    <div class="filters-row">
    ${inputs}
    </div>
    <div class="filters-actions">
      <button type="submit" data-testid="find-apply">Найти</button>
      <a href="/returns/find" data-testid="find-reset">Сбросить</a>
      <span class="hint" data-testid="find-count">Найдено: ${items.length}</span>
    </div>
  </form>
  ${rows(items)}
</div>`;
}
