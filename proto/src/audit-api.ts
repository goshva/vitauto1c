import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { guard } from './auth.ts';
import { problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { historyFor } from './audit.ts';

// Чтение журнала действий (аудит).
//
// «Кто изменил цену» — вопрос, на который журнал и заведён. Отвечает на него история
// ЗАПИСИ: по строке, документу или заказу.
//
// ПОЧЕМУ ЧТЕНИЕ ЗАКРЫТО, А ЗАПИСЬ НЕТ. Пишут все, кто что-то меняет, — иначе журнал
// неполон и бесполезен. Читают не все: журнал показывает себестоимость, цены и
// историю правок, то еестьть закрытые данные (ФТ v2 п. 5). Право на чтение — отдельное.

export const auditApi = createApi();

const Entry = z.object({
  id: z.string(),
  at: z.string().describe('Когда, ISO'),
  login: z.string().nullable().describe('Логин на момент действия'),
  role: z.string().nullable(),
  action: z.string().describe('create, update, delete, transition'),
  field: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  comment: z.string().nullable(),
});

/** Права на чтение журнала. */
const READERS = ['admin'];
export function canReadAudit(role: string): boolean {
  return READERS.includes(role);
}

// --- GET /lines/{id}/history — история одной строки ----------------------------------
auditApi.openapi(createRoute({
  method: 'get',
  path: '/lines/{id}/history',
  tags: ['audit'],
  summary: 'История строки: кто что менял и когда',
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: 'История от свежих к старым', content: { 'application/json': {
      schema: z.object({ entityId: uuid, items: z.array(Entry) }) } } },
    403: { description: 'Нет права читать журнал' },
  },
}), async (c) => {
  const denial = guard(c, 'audit.read');
  if (denial) return problemResponse(c, denial);

  const { id } = c.req.valid('param');
  return c.json({ entityId: id, items: await historyFor('line', id) }, 200);
});

// --- GET /audit — журнал с отбором ---------------------------------------------------
auditApi.openapi(createRoute({
  method: 'get',
  path: '/audit',
  tags: ['audit'],
  summary: 'Журнал действий: отбор по записи, пользователю, полю и периоду',
  request: {
    query: z.object({
      entity: z.string().optional().describe('Таблица: line, customer_order…'),
      entityId: uuid.optional(),
      login: z.string().optional(),
      field: z.string().optional().describe('Поле, по которому ищем: sale_price, cost_price…'),
      action: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(100),
    }),
  },
  responses: {
    200: { description: 'Записи журнала', content: { 'application/json': { schema: z.object({
      total: z.number().int(),
      items: z.array(Entry.extend({
        entity: z.string(),
        entityId: z.string(),
      })),
    }) } } },
    403: { description: 'Нет права читать журжурналал' },
  },
}), async (c) => {
  const denial = guard(c, 'audit.read');
  if (denial) return problemResponse(c, denial);

  const q = c.req.valid('query');
  const params: unknown[] = [];
  const parts: string[] = [];

  const eq = (column: string, value: string | undefined): void => {
    if (value === undefined || value === '') return;
    params.push(value);
    parts.push(`${column} = $${params.length}`);
  };
  eq('entity', q.entity);
  eq('entity_id', q.entityId);
  eq('login', q.login);
  eq('field', q.field);
  eq('action', q.action);

  if (q.dateFrom) { params.push(q.dateFrom); parts.push(`at >= $${params.length}::date`); }
  if (q.dateTo) { params.push(q.dateTo); parts.push(`at < ($${params.length}::date + 1)`); }

  const where = parts.length > 0 ? `where ${parts.join(' and ')}` : '';

  const total = await pool.query<{ n: string }>(
    `select count(*)::text n from audit_log ${where}`, params);
  params.push(q.limit);

  const r = await pool.query<{
    id: string; at: Date; login: string | null; role: string | null; action: string;
    field: string | null; old_value: string | null; new_value: string | null;
    comment: string | null; entity: string; entity_id: string;
  }>(
    `select id, at, login, role, action, field, old_value, new_value, comment,
            entity, entity_id
       from audit_log ${where}
      order by at desc, id desc
      limit $${params.length}`,
    params,
  );

  return c.json({
    total: Number(total.rows[0]!.n),
    items: r.rows.map((x) => ({
      id: x.id,
      at: x.at.toISOString(),
      login: x.login,
      role: x.role,
      action: x.action,
      field: x.field,
      oldValue: x.old_value,
      newValue: x.new_value,
      comment: x.comment,
      entity: x.entity,
      entityId: x.entity_id,
    })),
  }, 200);
});
