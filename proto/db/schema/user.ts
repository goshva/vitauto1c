import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Пользователи АРМ (учётные записи).
//
// ДО ЭТОГО РОЛЬ ПРЕДЪЯВЛЯЛАСЬ ЗАГОЛОВКОМ `X-Role`, и в отчёте это было записано как
// ограничение прототипа: «подделать его тривиально, и это не притворяется защитой».
// Заказчик попросил учётные записи — значит, появляется вход с паролем, а роль
// приходит из сессии.
//
// РОЛЬ ХРАНИТСЯ В УЧЁТНОЙ ЗАПИСИ, а не выбирается на входе. Иначе смысла в пароле
// нет: кто угодно вошёл бы под своим именем и выбрал себе роль администратора.

export const appUser = pgTable(
  'app_user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Логин. Уникален среди активных: двух «admin» быть не должно. */
    login: text('login').notNull(),
    /**
     * Хеш пароля. Никогда не сам пароль: в базе прототипа лежат демонстрационные
     * учётки, но привычка «хранить пароль как есть» переносится в продакшн.
     */
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    /** Роль из матрицы доступа (`domain/access.ts`). */
    role: text('role').notNull(),
    /** Отключённая учётка остаётся в истории: удалять её нельзя, ссылки из документов. */
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('app_user_login_idx').on(t.login)],
);
