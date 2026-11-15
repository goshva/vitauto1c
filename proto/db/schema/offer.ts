import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Предложения поставщиков (ФТ v2 п. 12).
//
// ФТ: «В строке заказа — поле выбора варианта, если одна деталь встречается у
// нескольких поставщиков или по разным ценам: список вариантов с ценой и сроком
// по каждому».
//
// ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ КОЛОНКИ В СТРОКЕ. «Одна деталь у нескольких
// поставщиков» — это связь «многие ко многим»: у позиции три предложения, у
// предложения своя цена и свой срок. Колонками в строке это выражается только
// тремя наборами полей, и четвёртый поставщик потребовал бы миграцию.
//
// В legacy так и было — `ref.supplier_offer`, отдельный справочник.

export const supplierOffer = pgTable(
  'supplier_offer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nomenclatureId: uuid('nomenclature_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    /** Цена предложения. Своя у каждого поставщика — за неё и выбирают. */
    price: numeric('price', { precision: 15, scale: 2 }).notNull(),
    /**
     * Срок поставки в днях. Второй критерий выбора после цены: деталь за 900 ₽
     * через три недели и за 1100 ₽ завтра — это разные решения.
     */
    deliveryDays: integer('delivery_days'),
    /** Артикул поставщика: у каждого он свой, и путать их нельзя. */
    article: text('article'),
    comment: text('comment'),
    /** Предложение действует с этой даты. Старые остаются: по ним считают историю. */
    actualFrom: timestamp('actual_from', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('supplier_offer_nomenclature_idx').on(t.nomenclatureId),
    index('supplier_offer_supplier_idx').on(t.supplierId),
  ],
);
