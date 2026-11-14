import { Hono } from 'hono';
import { pool } from './db.ts';
import { layout } from './views/html.ts';
import { invoicesTable, type InvoiceRow } from './views/invoices.ts';
import { checkInvoiceTransition } from './domain/invoice-state.ts';
import { SELECT, toItem } from './invoices-query.ts';

// Экран счетов (2 маршрута): список и переход состояния.
//
// Кнопки строятся из таблицы состояний домена, а действие ДЕЛЕГИРУЕТ тому же
// домену, что и API. Экран не выполняет переход сам: иначе появилась бы вторая
// реализация, и однажды кнопка и API разошлись бы — как в legacy разошлись
// четыре копии таблицы переходов.

export const invoicesUi = new Hono();

async function loadInvoices(): Promise<{ rows: InvoiceRow[]; unpaidTotal: string }> {
  const r = await pool.query<Parameters<typeof toItem>[0]>(
    `${SELECT} where i.deleted_at is null order by i.date desc, i.number desc`,
  );
  const unpaid = await pool.query<{ t: string }>(
    `select coalesce(sum(amount), 0)::text t from invoice
      where deleted_at is null and status <> 'paid'`,
  );
  return { rows: r.rows.map(toItem), unpaidTotal: unpaid.rows[0]!.t };
}

function invoicesPanel(rows: InvoiceRow[], unpaidTotal: string, message?: string): string {
  return `<div id="invoices-panel" data-testid="invoices-panel">
    ${message ? `<p class="hint-partial" data-testid="invoices-message">${message}</p>` : ''}
    ${invoicesTable(rows, unpaidTotal)}
  </div>`;
}

/**
 * Страница счетов целиком.
 *
 * Экспортируется, потому что её отдаёт МАРШРУТ API (`invoices.ts`) при запросе
 * HTML — как у `/lines` и `/fleet`: адрес один, формат выбирается по `Accept`.
 */
export async function invoicesPage(): Promise<string> {
  const { rows, unpaidTotal } = await loadInvoices();
  return layout({
    active: 'invoices',
    title: 'Счета',
    testId: 'page-invoices',
    body: `<p class="hint">Статус оплаты: черновик → отправлен → оплачен.
      Бухгалтерии здесь нет — только то, без чего нельзя закрыть заказ.</p>
      ${invoicesPanel(rows, unpaidTotal)}`,
  });
}

// --- POST /ui/invoices/transition ----------------------------------------------------

invoicesUi.post('/ui/invoices/transition', async (c) => {
  const form = await c.req.parseBody();
  const id = String(form.id ?? '');
  const to = String(form.to ?? '');

  const current = await pool.query<{ status: string }>(
    `select status from invoice where id = $1 and deleted_at is null`, [id],
  );

  let message: string | undefined;
  if (current.rowCount === 0) {
    message = 'Счёт не найден.';
  } else {
    const denial = checkInvoiceTransition(current.rows[0]!.status, to);
    if (denial) {
      // Причина показывается на странице, а не глотается: оператор должен видеть,
      // почему кнопка не сработала.
      message = denial;
    } else {
      await pool.query(
        `update invoice set status = $2,
                            paid_at = case when $2 = 'paid' then now() else paid_at end,
                            version = version + 1, updated_at = now()
          where id = $1`,
        [id, to],
      );
    }
  }

  const { rows, unpaidTotal } = await loadInvoices();
  return c.html(invoicesPanel(rows, unpaidTotal, message));
});
