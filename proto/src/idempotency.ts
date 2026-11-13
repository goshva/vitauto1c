import type { MiddlewareHandler } from 'hono';
import { pool } from './db.ts';

// Идемпотентность мутирующих запросов (prototype-spec.md §7).
//
// Клиент передаёт `Idempotency-Key`. Первый запрос выполняется и его ответ
// сохраняется; повтор с тем же ключом получает ТОТ ЖЕ ответ и не выполняет
// операцию второй раз.
//
// Зачем это нужно агенту: он ретраит запросы, не дождавшись ответа (таймаут сети,
// перезапуск процесса). Без ключа повтор POST создал бы второй заказ, и разбор
// занял бы больше времени, чем вся операция.
//
// Ключ уникален в пределах (метод, путь): одинаковый ключ для разных операций —
// это разные операции.

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export const idempotency: MiddlewareHandler = async (c, next) => {
  const key = c.req.header('idempotency-key')?.trim();
  if (!key || !MUTATING.has(c.req.method)) {
    await next();
    return;
  }

  const method = c.req.method;
  const path = c.req.path;

  const found = await pool.query<{ status: number; body: unknown }>(
    `select status, body from idempotency_key where key = $1 and method = $2 and path = $3
      order by created_at desc limit 1`,
    [key, method, path],
  );

  if (found.rowCount && found.rowCount > 0) {
    const row = found.rows[0]!;
    c.header('Idempotent-Replay', 'true');
    return c.json(row.body as never, row.status as 200);
  }

  await next();

  // Сохраняем только успешные ответы: повторять 4xx/5xx бессмысленно —
  // клиент должен исправить запрос, а не получить ту же ошибку из кэша.
  const res = c.res;
  if (res.status >= 200 && res.status < 300) {
    try {
      const body = await res.clone().json();
      await pool.query(
        `insert into idempotency_key (key, method, path, status, body) values ($1, $2, $3, $4, $5)`,
        [key, method, path, res.status, JSON.stringify(body)],
      );
    } catch {
      // Тело не JSON (печатная форма) — ключ не сохраняем, повтор выполнит операцию.
      // Это осознанно: HTML-ответ нечего воспроизводить.
    }
  }
};
