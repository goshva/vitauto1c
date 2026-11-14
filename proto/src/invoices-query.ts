import { invoiceStatusTitle } from './domain/invoice-state.ts';

// Общий запрос счёта. Вынесено из `invoices.ts`: там уже два маршрута, и вместе
// с переходом файл перевалил за 200 строк.

export const SELECT = `
  select i.id, i.number, i.date, i.status, i.kind, i.amount::text, i.comment, i.paid_at,
         c.name as counterparty
    from invoice i
    left join counterparty c on c.id = i.counterparty_id and c.deleted_at is null`;

export interface InvoiceRow {
  id: string; number: string | null; date: Date; status: string; kind: string;
  amount: string | null; counterparty: string | null; comment: string | null;
  paid_at: Date | null;
}

/** Строка БД → элемент ответа. Состояние переводится на язык оператора здесь. */
export const toItem = (r: InvoiceRow) => ({
  id: r.id, number: r.number, date: r.date.toISOString().slice(0, 10),
  status: r.status, statusTitle: invoiceStatusTitle(r.status), kind: r.kind,
  amount: r.amount, counterparty: r.counterparty, comment: r.comment,
  paidAt: r.paid_at ? r.paid_at.toISOString() : null,
  canPay: r.status === 'sent',
});
