import { boolean, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Ремонт, уведомления и задания. Вынесено из `doc.ts`: файл обязан держать
// ≤ 200 строк и ≤ 5 экспортов, иначе теряется контекст.

const stamp = () => ({
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Заказ-наряд (ремонт). 11 столбцов вместо 24 + 14 + 15.
//
// `status` — состояние документа G1 → G9: открыт → в работе → закрыт.
// Строки заказ-наряда (работы и запчасти) — обычные строки `line` со ссылкой
// `line.work_order_id`: у них уже есть `service_type_id` и `norm_hours`.
export const workOrder = pgTable(
  'work_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number'),
    date: timestamp('date').notNull().defaultNow(),
    status: text('status').$type<'new' | 'in_work' | 'closed'>().notNull().default('new'),
    carId: uuid('car_id'),
    counterpartyId: uuid('counterparty_id'),
    organizationId: uuid('organization_id'),
    serviceTypeId: uuid('service_type_id'),
    total: numeric('total', { precision: 15, scale: 2 }),
    ...stamp(),
  },
  (t) => [
    index('work_order_number_idx').on(t.number),
    index('work_order_status_idx').on(t.status),
  ],
);

// Уведомление. 6 столбцов вместо 21 (без onec_*, extra, import_batch_id).
//
// В legacy уведомления писал триггер `line_status_notice` — бизнес-логика в триггере.
// В прототипе триггеров с бизнес-логикой нет: уведомление создаёт приложение.
export const notice = pgTable(
  'notice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    node: text('node').notNull(),
    kind: text('kind').notNull(),
    recipientRole: text('recipient_role').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    isRead: boolean('is_read').notNull().default(false),
    customerOrderId: uuid('customer_order_id'),
  },
  (t) => [index('notice_node_idx').on(t.node), index('notice_unread_idx').on(t.isRead)],
);

// Задание (фоновая обработка). 6 столбцов вместо 8.
//
// В legacy задание уходило в 1С; в прототипе выполняется в приложении
// (prototype-spec.md §6). `kind` различает задания: in_work, print, notify.
export const job = pgTable(
  'job',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    state: text('state').notNull().default('new'),
    message: text('message'),
    processed: boolean('processed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('job_state_idx').on(t.state)],
);
