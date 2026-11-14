import { esc } from './html.ts';

// Экран неопознанных позиций: розыск и привязка номенклатуры (K8, A1).
//
// API было с самого начала, а экрана не было — на него ссылалась модель, и оператор
// не мог сделать то, что описано в сценарии. Здесь тот же слой, что у `/stock`:
// представление отдельно от маршрутов.
//
// Действие ДЕЛЕГИРУЕТ в API (`/lines/{id}/bind`), как действия документов: логика
// сопоставления остаётся в одном месте, а не повторяется в экране.

export interface UnidentifiedRow {
  id: string;
  status: string;
  quantity: string | null;
  factName: string | null;
  factArticle: string | null;
  plate: string | null;
  cell: string | null;
  comment: string | null;
}

export interface Option {
  id: string;
  title: string;
}

function row(r: UnidentifiedRow, nomenclatures: Option[], zones: Option[]): string {
  const options = nomenclatures
    .map((o) => `<option value="${esc(o.id)}">${esc(o.title)}</option>`)
    .join('\n        ');
  const zoneOptions = zones
    .map((o) => `<option value="${esc(o.id)}">${esc(o.title)}</option>`)
    .join('\n        ');

  return `<tr data-testid="unidentified-${esc(r.id)}">
  <td>${esc(r.factName ?? '—')}</td>
  <td class="c-code">${esc(r.factArticle ?? '—')}</td>
  <td class="c-num">${esc(r.quantity ?? '—')}</td>
  <td class="c-code">${esc(r.cell ?? '—')}</td>
  <td>${esc(r.plate ?? '—')}</td>
  <td class="c-comment">${esc(r.comment ?? '—')}</td>
  <td>
    <form class="bind" hx-post="/ui/unidentified/bind" hx-target="#unidentified-panel" hx-swap="outerHTML">
      <input type="hidden" name="lineId" value="${esc(r.id)}">
      <select name="nomenclatureId" data-testid="bind-nomenclature-${esc(r.id)}">
        ${options}
      </select>
      <select name="zoneId" title="Куда положить после опознания">
        <option value="">оставить где лежит</option>
        ${zoneOptions}
      </select>
      <button type="submit" data-testid="bind-submit-${esc(r.id)}">Опознать</button>
    </form>
  </td>
</tr>`;
}

export function unidentifiedTable(
  rows: UnidentifiedRow[],
  nomenclatures: Option[],
  zones: Option[],
): string {
  if (rows.length === 0) {
    return `<p data-testid="unidentified-empty">Неопознанных позиций нет.
      Сюда попадают строки без номенклатуры — те, что кладовщик не смог сопоставить.</p>`;
  }

  return `<table class="unidentified" data-testid="unidentified-table">
  <thead><tr>
    <th>Как пришло</th><th>Артикул</th><th class="c-num">Кол-во</th>
    <th>Ячейка</th><th>Машина</th><th>Комментарий</th><th>Опознать</th>
  </tr></thead>
  <tbody>
${rows.map((r) => row(r, nomenclatures, zones)).join('\n')}
  </tbody>
</table>`;
}

/** Сводка: сколько ждёт опознания. */
export function unidentifiedSummary(rows: UnidentifiedRow[]): string {
  const noArticle = rows.filter((r) => !r.factArticle).length;
  return `<p class="hint" data-testid="unidentified-summary">
    Ждут опознания: <strong>${rows.length}</strong>${
      noArticle ? ` · без артикула: <strong>${noArticle}</strong>` : ''}
  </p>`;
}
