import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Бренды номенклатуры (ФТ v2 п. 19). В legacy — `ref.brand` (миграция 0013:
// «Бренды номенклатуры (ТЗ 2.2)», с полем «Страна»).
//
// Вынесено в отдельный файл, а не в `ref.ts`: там уже пять экспортов, и шестой
// упирается в предел из §12 задания. Заодно это честнее по смыслу — бренд
// самостоятельный справочник, а не часть карточки номенклатуры.
//
// ПОЧЕМУ ЭТА ТАБЛИЦА ВАЖНА. Колонка `nomenclature.brand_id` существовала с самого
// начала, а таблицы не было: висячий UUID без связи. Поле выглядело заполненным,
// но выбрать бренд было негде, а проверить — нечем.

const stamp = () => ({
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const brand = pgTable(
  'brand',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code'),
    name: text('name').notNull(),
    /** Страна бренда. Необязательна — как и в legacy. */
    country: text('country'),
    comment: text('comment'),
    ...stamp(),
  },
  (t) => [index('brand_name_idx').on(t.name)],
);
