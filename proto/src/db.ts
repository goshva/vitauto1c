import { Pool } from 'pg';

// Соединение с БД прототипа. База ОТДЕЛЬНАЯ (vitauto_proto), чтобы не задеть
// ручной стенд на vitauto_app — см. prototype-spec.md §13.1 (Q6).
//
// Запасной адрес указывает на vitauto_proto, а не на vitauto_app: если .env
// забыли, тест упадёт на «нет таблиц», а не испортит данные ручного стенда.
export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5434/vitauto_proto';

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 2_000,
});

/**
 * Проверка живости БД для /health.
 *
 * Никогда не бросает: health обязан ОТВЕТИТЬ и сказать правду, иначе мониторинг
 * не отличит «сервис мёртв» от «сервис жив, БД лежит».
 */
export async function dbPing(): Promise<'up' | 'down'> {
  try {
    await pool.query('select 1');
    return 'up';
  } catch {
    return 'down';
  }
}
