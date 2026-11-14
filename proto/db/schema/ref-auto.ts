import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Автомобили, формы оплаты и виды услуг. Вынесено из `ref.ts`.

const stamp = () => ({
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/**
 * ТС муниципального автопарка — объект обслуживания.
 *
 * Расширено по Q2: пробег (триггер планового ТО), статус («где машина сейчас»)
 * и подразделение (за кем закреплена). Отдельная таблица `vehicle` НЕ заводится:
 * `car` уже связан с заказ-нарядами, и вторая таблица на ту же сущность — ровно
 * та болезнь, из-за которой в legacy `arm.line` и `doc.customer_order_item` разошлись.
 */
export const car = pgTable(
  'car',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code'),
    name: text('name').notNull(),
    vin: text('vin'),
    year: integer('year'),
    modelId: uuid('model_id'),
    engineNo: text('engine_no'),
    bodyNo: text('body_no'),
    chassisNo: text('chassis_no'),
    color: text('color'),
    /** Пробег, км. Растёт при закрытии наряда и вручную. */
    mileage: integer('mileage'),
    /** Пробег на момент последнего ТО — от него считается срок следующего. */
    mileageAtService: integer('mileage_at_service'),
    /** Дата последнего выполненного ТО — второй триггер (по календарю). */
    lastServiceAt: timestamp('last_service_at', { withTimezone: true }),
    /** on_line — на линии, in_repair — в ремонте, written_off — списано. */
    status: text('status').$type<'on_line' | 'in_repair' | 'written_off'>().notNull().default('on_line'),
    departmentId: uuid('department_id'),
    comment: text('comment'),
    ...stamp(),
  },
  (t) => [index('car_vin_idx').on(t.vin), index('car_status_idx').on(t.status)],
);

// Атрибуты авто: марка, модель, госномер, VIN, двигатель, агрегат, шасси.
// В legacy эти семь значений лежали прямо в `arm.line` (столбцы 47–57).
export const carAttribute = pgTable(
  'car_attribute',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carId: uuid('car_id'),
    attrKind: text('attr_kind').notNull(),
    valueType: text('value_type'),
    valueValue: text('value_value'),
    period: timestamp('period'),
    ...stamp(),
  },
  (t) => [index('car_attribute_car_idx').on(t.carId), index('car_attribute_kind_idx').on(t.attrKind)],
);

export const paymentForm = pgTable('payment_form', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code'),
  name: text('name').notNull(),
  ...stamp(),
});

export const serviceKind = pgTable('service_kind', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code'),
  name: text('name').notNull(),
  ...stamp(),
});
