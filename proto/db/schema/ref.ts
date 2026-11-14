import { boolean, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Основные справочники (решение заказчика Q3: переписываем 13 нужных).
//
// Legacy-версии несут 1С-обвязку: onec_version, extra, import_batch_id, predefined,
// parent_id, is_folder, ext_code, search_status, ownership, analog_id, deleted_by_id.
// В прототипе остаётся только нужное бизнесу.
//
// Склады и партии — в `ref-stock.ts`; авто, оплата и виды услуг — в `ref-auto.ts`.
// Разделение по 200 строк и 5 экспортов: в большом файле теряется контекст.

const stamp = () => ({
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Номенклатура. В §4.3 задания заявлена как одна из 12 предметных таблиц:
// объединяет ref.nomenclature + ref.price + ref.unit.
export const nomenclature = pgTable(
  'nomenclature',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code'),
    name: text('name').notNull(),
    article: text('article'),
    /**
     * Наименование ДЛЯ ПЕЧАТИ (ФТ v2 п. 19).
     *
     * Колонка была с самого начала, но печатные формы её не использовали: в бланк
     * шло короткое `name`. Смысл разделения в том, что в списке удобно короткое
     * («Фильтр масляный»), а в документе нужно полное, с артикулом и объёмом.
     */
    fullName: text('full_name'),
    /**
     * Единица хранения. По умолчанию — ШТУКИ (ФТ v2 п. 19), но БЕЗ жёсткого
     * запрета смены: литры, комплекты и нормо-часы бывают нужны. Поле остаётся
     * необязательным, и связь с `unit` держит его осмысленным.
     */
    unitId: uuid('unit_id').references(() => unit.id),
    kind: text('kind').$type<'good' | 'service'>(),
    brandId: uuid('brand_id').references(() => brand.id),
    /**
     * Код поставщика (ФТ v2 п. 19). В legacy — `ref.nomenclature.ext_code`:
     * артикул производителя, по которому поставщик находит позицию. Не совпадает
     * с нашим `article`, и путать их нельзя — иначе заказ уйдёт не с тем кодом.
     */
    extCode: text('ext_code'),
    /**
     * Аналог — связанная номенклатура (ФТ v2 п. 16, блок «Аналоги»).
     *
     * Прямая связь «аналог ↔ аналог», без дерева: в legacy так и было
     * (`ref.nomenclature.analog_id`, миграция 0013, «кросс-код»). Дерево
     * потребовало бы отдельной таблицы связей и порядка обхода — для подсказки
     * снабженцу «вот чем можно заменить» это лишнее.
     *
     * Ссылка на себя запрещена проверкой в миграции: позиция не аналог сама себе.
     */
    analogId: uuid('analog_id'),
    price: numeric('price', { precision: 15, scale: 2 }),
    priceTypeId: uuid('price_type_id'),
    comment: text('comment'),
    ...stamp(),
  },
  (t) => [
    index('nomenclature_code_idx').on(t.code),
    index('nomenclature_article_idx').on(t.article),
    index('nomenclature_name_idx').on(t.name),
    index('nomenclature_ext_code_idx').on(t.extCode),
  ],
);

/**
 * Бренды переехали в `brand.ts`: в этом файле пять экспортов, и шестой упирается
 * в предел из §12 задания.
 */
import { brand } from './brand.ts';

/**
 * Бренды номенклатуры (ФТ v2 п. 19). В legacy — `ref.brand` (миграция 0013).
 *
 * Колонка `nomenclature.brand_id` существовала, а САМОЙ ТАБЛИЦЫ НЕ БЫЛО: висячий
 * UUID без связи. Бренд нельзя было ни выбрать, ни проверить — поле выглядело
 * заполненным, но ни на что не ссылалось.
 */

export const unit = pgTable('unit', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code'),
  name: text('name').notNull(),
  fullName: text('full_name'),
  intlCode: text('intl_code'),
  ...stamp(),
});

export const counterparty = pgTable(
  'counterparty',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code'),
    name: text('name').notNull(),
    fullName: text('full_name'),
    legalForm: text('legal_form'),
    inn: text('inn'),
    kpp: text('kpp'),
    isCustomer: boolean('is_customer').notNull().default(false),
    isSupplier: boolean('is_supplier').notNull().default(false),
    inactive: boolean('inactive').notNull().default(false),
    comment: text('comment'),
    ...stamp(),
  },
  (t) => [index('counterparty_name_idx').on(t.name), index('counterparty_inn_idx').on(t.inn)],
);

export const contract = pgTable(
  'contract',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code'),
    name: text('name'),
    contractNo: text('contract_no'),
    contractDate: timestamp('contract_date'),
    counterpartyId: uuid('counterparty_id'),
    organizationId: uuid('organization_id'),
    priceTypeId: uuid('price_type_id'),
    kind: text('kind'),
    inactive: boolean('inactive').notNull().default(false),
    comment: text('comment'),
    ...stamp(),
  },
  (t) => [index('contract_counterparty_idx').on(t.counterpartyId)],
);

export const organization = pgTable('organization', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code'),
  name: text('name').notNull(),
  fullName: text('full_name'),
  shortName: text('short_name'),
  inn: text('inn'),
  kpp: text('kpp'),
  ogrn: text('ogrn'),
  prefix: text('prefix'),
  ...stamp(),
});
