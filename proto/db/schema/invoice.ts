import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Счёт: статус оплаты, а не бухгалтерия.
//
// Заказчик (Q6) запросил МИНИМУМ: без него нельзя закрыть тендер и заказ
// поставщику — «оплачено» неоткуда взять. Специально НЕ входит: платёжные
// поручения, банковские выписки, НДС, счета-фактуры, книги покупок и продаж.
//
// Вынесено из `doc.ts`: там уже пять экспортов, а файл держит не больше пяти.

const stamp = () => ({
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const invoice = pgTable(
  'invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number'),
    date: timestamp('date').notNull().defaultNow(),
    /** draft → sent → paid. Три перехода, без бухгалтерских проводок. */
    status: text('status').$type<'draft' | 'sent' | 'paid'>().notNull().default('draft'),
    /** incoming — от поставщика, outgoing — заказчику. */
    kind: text('kind').$type<'incoming' | 'outgoing'>().notNull().default('outgoing'),
    counterpartyId: uuid('counterparty_id'),
    organizationId: uuid('organization_id'),
    /** Заказ покупателя, если счёт выставлен по нему. */
    customerOrderId: uuid('customer_order_id'),
    /** Заказ поставщику, если счёт получен по нему. */
    supplierOrderId: uuid('supplier_order_id'),
    amount: numeric('amount', { precision: 15, scale: 2 }),
    /** Дата фактической оплаты — заполняется на переходе в `paid`. */
    paidAt: timestamp('paid_at', { withTimezone: true }),
    comment: text('comment'),
    ...stamp(),
  },
  (t) => [
    index('invoice_status_idx').on(t.status),
    index('invoice_order_idx').on(t.customerOrderId),
    index('invoice_supplier_order_idx').on(t.supplierOrderId),
  ],
);
