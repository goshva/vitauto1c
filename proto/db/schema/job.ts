import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Регламентные задания: что должно происходить само, и что из этого произошло.
//
// ЗАЧЕМ ДВЕ ТАБЛИЦЫ, А НЕ ОДНА. Первая — состояние расписания (когда задание должно
// сработать в следующий раз и когда сработало в последний), вторая — история пусков.
// Смешав их, нельзя было бы ответить на главный вопрос: «задание вообще запускалось
// или расписание молчит?». А это и есть та поломка, которую замечают последней:
// планировщик, который тихо не работает, выглядит как работающий.
//
// ПОЧЕМУ ИСТОРИЯ ПУСКОВ ОБЯЗАТЕЛЬНА. Задание, которое никогда не запускалось и нигде
// об этом не сказало, равносильно отсутствующему. Поэтому каждая попытка — строка:
// начало, конец, итог, сообщение, длительность.

export const scheduledJob = pgTable('scheduled_job', {
  /** Имя задания — оно же ключ: `backup`, `notices-daily`, `stock-check`. */
  name: text('name').primaryKey(),
  title: text('title').notNull(),
  /** Расписание в понятном виде: `каждый день в 20:00`. Для экрана, не для расчёта. */
  schedule: text('schedule').notNull(),
  /** Через сколько часов задание считается просроченным. */
  everyHours: integer('every_hours').notNull(),
  /** Когда сработало в последний раз. Пусто — не срабатывало ни разу. */
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  /** Сколько раз подряд не получилось. Сбрасывается удачным пуском. */
  failedStreak: integer('failed_streak').notNull().default(0),
  /** Задание выключено вручную. Выключенное не считается просроченным. */
  enabled: integer('enabled').notNull().default(1),
});

export const scheduledJobRun = pgTable(
  'scheduled_job_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** `ok`, `failed` или `running`. */
    status: text('status').notNull(),
    /** Что сделано словами: «копий: 1, проверена: 1» или причина отказа. */
    message: text('message'),
    /** Кто запустил: `schedule` или логин админисадминистратораратора. */
    startedBy: text('started_by'),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    index('scheduled_job_run_name_idx').on(t.name, t.startedAt),
    index('scheduled_job_run_started_idx').on(t.startedAt),
  ],
);
