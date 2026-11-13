import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Ключи идемпотентности для мутирующих запросов (prototype-spec.md §7).
//
// Зачем: агент (и любой клиент с ретраями) может повторить POST, не получив ответ.
// Без ключа повтор создаст второй заказ; с ключом — вернётся тот же результат.
//
// Ключ уникален в пределах метода и пути: один и тот же ключ для разных операций —
// это разные операции, и смешивать их нельзя.
export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    status: integer('status').notNull(),
    body: jsonb('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Один ключ на (метод, путь): повтор возвращает сохранённый ответ.
    index('idempotency_key_uniq').on(t.key, t.method, t.path),
    index('idempotency_key_created_idx').on(t.createdAt),
  ],
);
