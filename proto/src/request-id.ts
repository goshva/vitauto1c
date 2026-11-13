import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env.ts';

// Сквозной идентификатор запроса (prototype-spec.md §7: X-Request-ID → trace_id).
// Пришёл от клиента — сохраняем; нет — генерируем. Возвращаем в ответе всегда,
// чтобы агент мог связать ответ, лог и тест по одному значению.
export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && incoming.trim().length > 0 ? incoming : crypto.randomUUID();

  c.set('requestId', id);
  c.header('X-Request-ID', id);

  await next();
};
