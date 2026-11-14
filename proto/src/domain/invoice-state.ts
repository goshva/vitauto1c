// Состояния счёта: статус оплаты, а не бухгалтерия (Q6).
//
// Заказчику нужен минимальный учёт оплаты — без него нельзя закрыть заказ
// поставщику и показать «сколько заработали». Три состояния и три перехода;
// никаких платёжных поручений, выписок, НДС и книг покупок/продаж.

export type InvoiceStatus = 'draft' | 'sent' | 'paid';

export const INVOICE_STATES: Record<InvoiceStatus, { title: string; next: InvoiceStatus[] }> = {
  draft: { title: 'Черновик', next: ['sent'] },
  sent: { title: 'Отправлен', next: ['paid'] },
  paid: { title: 'Оплачен', next: [] },
};

/** Название состояния для оператора. */
export const invoiceStatusTitle = (status: string): string =>
  INVOICE_STATES[status as InvoiceStatus]?.title ?? status;

/**
 * Можно ли перевести счёт.
 *
 * Возвращается ПРИЧИНА отказа или `null`. Так же, как у переходов строки: отказ
 * обязан называть, что доступно, иначе оператор не понимает, почему кнопка молчит.
 */
export function checkInvoiceTransition(from: string, to: string): string | null {
  const state = INVOICE_STATES[from as InvoiceStatus];
  if (!state) {
    return `Неизвестное состояние счёта «${from}». Допустимые: ${Object.keys(INVOICE_STATES).join(', ')}.`;
  }
  if (!(to in INVOICE_STATES)) {
    return `Неизвестное состояние «${to}». Допустимые: ${Object.keys(INVOICE_STATES).join(', ')}.`;
  }
  if (!state.next.includes(to as InvoiceStatus)) {
    const available = state.next.length
      ? state.next.map((s) => `«${INVOICE_STATES[s].title}»`).join(', ')
      : 'нет — счёт оплачен и дальше не движется';
    return `Из состояния «${state.title}» нельзя перейти в «${INVOICE_STATES[to as InvoiceStatus].title}». Доступно: ${available}.`;
  }
  return null;
}
