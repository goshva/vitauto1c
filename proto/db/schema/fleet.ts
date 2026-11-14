import { boolean, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Автопарк: подразделения, сотрудники, регламентное ТО.
//
// Заказчик (Q1, Q2) определил ядро как муниципальный автопарк с ремонтом:
// ТС — объект обслуживания, а не товар. До этого ТС было только карточкой
// (`car`), и по ней нельзя было ответить «какая машина требует ТО».
//
// Само ТС НЕ дублируется отдельной таблицей `vehicle`: `car` уже есть и уже
// связан с заказ-нарядами. Вторая таблица на ту же сущность — ровно та болезнь,
// из-за которой в legacy `arm.line` и `doc.customer_order_item` разошлись.
// Вместо этого `car` расширяется пробегом, статусом и подразделением.

const stamp = () => ({
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** Подразделение муниципалитета, за которым закреплены ТС и сотрудники. */
export const department = pgTable(
  'department',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code'),
    name: text('name').notNull(),
    headEmployeeId: uuid('head_employee_id'),
    ...stamp(),
  },
  (t) => [index('department_code_idx').on(t.code)],
);

/**
 * Сотрудник: исполнитель работ и владелец подписи в акте.
 *
 * Заказчик (Q3) потребовал И роль, И конкретного сотрудника: роль даёт права,
 * сотрудник — подпись в акте, выработку и историю «кто закрыл наряд».
 * Логин живёт отдельно (`auth`), здесь — кадровые данные.
 */
export const employee = pgTable(
  'employee',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: text('full_name').notNull(),
    /** Роль сотрудника: admin | municipality | manager | mechanic | storekeeper. */
    role: text('role').notNull(),
    departmentId: uuid('department_id'),
    /** Должность для печатных форм: «механик», «кладовщик». */
    position: text('position'),
    phone: text('phone'),
    email: text('email'),
    /** Признак «может подписывать акт» — юридически значимая подпись. */
    canSign: boolean('can_sign').notNull().default(false),
    ...stamp(),
  },
  (t) => [index('employee_role_idx').on(t.role), index('employee_department_idx').on(t.departmentId)],
);

/**
 * Правило регламентного ТО: через какой пробег и сколько дней повторять.
 *
 * `mileageInterval` — триггер планового ТО (Q2: «ТО через 500 км»).
 * Срок считается от ПОСЛЕДНЕГО выполненного ТО по этому правилу, а не от
 * календаря: иначе машина, стоявшая полгода, получит заявку ни за что.
 */
export const maintenanceRule = pgTable(
  'maintenance_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code'),
    name: text('name').notNull(),
    /** Модель ТС, к которой применимо правило; null — ко всем. */
    carModelId: uuid('car_model_id'),
    /** Интервал пробега, км. */
    mileageInterval: integer('mileage_interval'),
    /** Интервал по календарю, дней. */
    dayInterval: integer('day_interval'),
    /** Нормо-часы типового ТО — для предварительной оценки. */
    normHours: numeric('norm_hours', { precision: 10, scale: 2 }),
    ...stamp(),
  },
  (t) => [index('maintenance_rule_model_idx').on(t.carModelId)],
);
