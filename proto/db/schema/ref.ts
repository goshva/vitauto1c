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
    fullName: text('full_name'),
    unitId: uuid('unit_id'),
    kind: text('kind').$type<'good' | 'service'>(),
    brandId: uuid('brand_id'),
    price: numeric('price', { precision: 15, scale: 2 }),
    priceTypeId: uuid('price_type_id'),
    comment: text('comment'),
    ...stamp(),
  },
  (t) => [
    index('nomenclature_code_idx').on(t.code),
    index('nomenclature_article_idx').on(t.article),
    index('nomenclature_name_idx').on(t.name),
  ],
);

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
