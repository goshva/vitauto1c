import { esc } from './html.ts';

// Экран счетов: список со статусом оплаты и кнопками переходов.
//
// Кнопки строятся из ТОЙ ЖЕ таблицы состояний, что проверяет API
// (`domain/invoice-state.ts`): кнопка не может появиться там, где переход запрещён.
// Действия делегируют в API — второй реализации перехода нет.

export interface InvoiceRow {
  id: string;
  number: string | null;
  date: string;
  status: string;
  statusTitle: string;
  kind: string;
  amount: string | null;
  counterparty: string | null;
  comment: string | null;
  paidAt: string | null;
}

/** Следующий допустимый переход и его подпись. */
const NEXT: Record<string, { to: string; title: string }> = {
  draft: { to: 'sent', title: 'Отправить' },
  sent: { to: 'paid', title: 'Оплатить' },
};

const KIND_TITLES: Record<string, string> = {
  incoming: 'Входящий',
  outgoing: 'Исходящий',
};

function row(inv: InvoiceRow): string {
  const next = NEXT[inv.status];
  const button = next
    ? `<button type="button" data-testid="invoice-action-${esc(inv.id)}-${esc(next.to)}"
        hx-post="/ui/invoices/transition" hx-vals='{"id":"${esc(inv.id)}","to":"${esc(next.to)}"}'
        hx-target="#invoices-panel" hx-swap="outerHTML">${esc(next.title)}</button>`
    : '<span class="empty">Оплачен</span>';

  return `<tr data-testid="invoice-${esc(inv.id)}" data-status="${esc(inv.status)}">
  <td class="c-code">${esc(inv.number ?? '—')}</td>
  <td class="c-num">${esc(inv.date)}</td>
  <td>${esc(KIND_TITLES[inv.kind] ?? inv.kind)}</td>
  <td>${esc(inv.counterparty ?? '—')}</td>
  <td class="c-num" data-testid="invoice-amount-${esc(inv.id)}">${esc(inv.amount ?? '—')}</td>
  <td class="c-status s-${esc(inv.status)}" data-testid="invoice-status-${esc(inv.id)}">${esc(inv.statusTitle)}</td>
  <td>${esc(inv.comment ?? '—')}</td>
  <td>${button}</td>
</tr>`;
}

export function invoicesTable(rows: InvoiceRow[], unpaidTotal: string): string {
  const total = `<p class="hint" data-testid="invoices-unpaid">
    Не оплачено: <strong>${esc(unpaidTotal)}</strong> ₽ · счетов: <strong>${rows.length}</strong>
  </p>`;

  if (rows.length === 0) {
    return `${total}<p data-testid="invoices-empty">Счетов нет. Выставьте счёт по заказу или вручную.</p>`;
  }

  return `${total}<table class="invoices" data-testid="invoices-table">
  <thead><tr>
    <th>Номер</th><th class="c-num">Дата</th><th>Вид</th><th>Контрагент</th>
    <th class="c-num">Сумма</th><th>Состояние</th><th>Примечание</th><th>Действие</th>
  </tr></thead>
  <tbody>
${rows.map(row).join('\n')}
  </tbody>
</table>`;
}
