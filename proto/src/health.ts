import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { dbPing } from './db.ts';

// Схема ответа = тип = валидация = OpenAPI (prototype-spec.md §3: один источник).
export const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('vitauto-proto'),
  version: z.string().min(1),
  db: z.enum(['up', 'down']),
});

export const VERSION = '0.1.0';

const route = createRoute({
  method: 'get',
  path: '/health',
  tags: ['service'],
  summary: 'Живость сервиса и БД',
  responses: {
    200: {
      description: 'Сервис отвечает; db сообщает доступность базы отдельно',
      content: { 'application/json': { schema: HealthSchema } },
    },
  },
});

export const health = createApi();

health.openapi(route, async (c) => {
  return c.json(
    {
      status: 'ok' as const,
      service: 'vitauto-proto' as const,
      version: VERSION,
      db: await dbPing(),
    },
    200,
  );
});
