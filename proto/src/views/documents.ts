import { esc } from './html.ts';

// Таблица документов: возвраты, отгрузки, заказы поставщику, заказ-наряды.
//
// Одна таблица на четыре вида: отличаются они только набором состояний, а он
// приходит из домена. Кнопки строятся из ТОЙ ЖЕ таблицы состояний, что проверяет
// API, — поэтому кнопка не может появиться там, где переход запрещён (C21).

export interface DocumentRow {
  id: string;
  number: string | null;
  date: string;
  status: string;
  /** Название состояния для оператора. */
  statusTitle: string;
  /** Допустимые переходы: целевой статус и его название. */
  next: { to: string; title: string }[];
}

function row(kind: string, doc: DocumentRow): string {
  const buttons = doc.next
    .map(
      (n) => `<button type="button" data-testid="doc-action-${esc(doc.id)}-${esc(n.to)}"
        hx-post="/ui/documents/${esc(kind)}/${esc(doc.id)}/${esc(n.to)}"
        hx-target="body" hx-swap="innerHTML">${esc(n.title)}</button>`,
    )
    .join('\n        ');

  return `<tr data-testid="doc-${esc(doc.id)}" data-status="${esc(doc.status)}">
  <td class="c-code">${esc(doc.number ?? '—')}</td>
  <td class="c-num">${esc(doc.date)}</td>
  <td data-testid="doc-status-${esc(doc.id)}" class="c-status s-${esc(doc.status)}">
    ${esc(doc.statusTitle)}</td>
  <td class="doc-actions">${buttons || '<span class="empty">—</span>'}</td>
</tr>`;
}

export function documentsTable(kind: string, rows: DocumentRow[]): string {
  return `<table class="docs" data-testid="documents-table" data-kind="${esc(kind)}">
  <thead>
    <tr>
      <th>Номер</th>
      <th class="c-num">Дата</th>
      <th>Состояние</th>
      <th>Действия</th>
    </tr>
  </thead>
  <tbody>
${rows.map((d) => row(kind, d)).join('\n')}
  </tbody>
</table>`;
}
