import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { uuid } from './domain/uuid.ts';
import { guard } from './auth.ts';

// ИСТОРИЯ ЗАКАЗ-НАРЯДА.
//
// Решение заказчика (20.11.2026): историю наряда видит АДМИНИСТРАТОР И МЕХАНИК, но БЕЗ
// СЕБЕСТОИМОСТИ. Отсюда два отличия от общего журнала (`/audit`):
//   • своё право (`work_order.history`) вместо `audit.read`, который открыт только
//     администратору и показывает цены;
//   • из ответа ВЫРЕЗАЮТСЯ закупочные цены — и из полей, и из `details`.
//
// Почему отдельным файлом, а не в `work-orders.ts`: тот уже держит список, карточку и
// открытие наряда, и вместе с историей перевалил бы за предел 200 строк из §12.

export const workOrdersHistory = createApi();

const Entry = z.object({
  at: z.string(),
  login: z.string().nullable(),
  role: z.string().nullable(),
  action: z.string(),
  field: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  comment: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).describe('Без себестоимости: закупочные цены вырезаны'),
});

/**
 * Убирает себестоимость из подробностей записи.
 *
 * Проверка по ИМЕНИ поля, а не по списку: `costPrice`, `cost_price`, `costSum` — одно и
 * то же по смыслу, и перечислять написания значило бы однажды забыть новое.
 */
const withoutCost = (details: unknown): Record<string, unknown> => {
  if (!details || typeof details !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (/cost/i.test(key)) continue;
    out[key] = value;
  }
  return out;
};

workOrdersHistory.openapi(createRoute({
  method: 'get',
  path: '/work-orders/{id}/history',
  tags: ['repair'],
  summary: 'История заказ-наряда: кто и что делал (без себестоимости)',
  request: {
    params: z.object({ id: uuid }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    }),
  },
  responses: {
    200: { description: 'Записи журнала по наряду, свежие первыми', content: {
      'application/json': { schema: z.object({
        entityId: uuid, total: z.number().int(), items: z.array(Entry),
      }) } } },
    403: { description: 'История наряда доступна администратору и механику' },
    404: { description: 'Заказ-наряд не найден' },
  },
}), async (c) => {
  const noRight = guard(c, 'work_order.history');
  if (noRight) return problemResponse(c, noRight);

  const { id } = c.req.valid('param');
  const { limit } = c.req.valid('query');

  const order = await pool.query(
    `select 1 from work_order where id = $1 and deleted_at is null`, [id]);
  if (order.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Заказ-наряд ${id} не найден`));
  }

  // Свежие первыми: при разборе работы нужен последний, кто тронул наряд.
  const r = await pool.query<{
    at: Date; login: string | null; role: string | null; action: string;
    field: string | null; old_value: string | null; new_value: string | null;
    comment: string | null; details: unknown;
  }>(
    `select at, login, role, action, field, old_value, new_value, comment, details
       from audit_log
      where entity = 'work_order' and entity_id = $1
      order by at desc, id desc
      limit $2`,
    [id, limit],
  );

  return c.json({
    entityId: id,
    total: r.rowCount ?? 0,
    items: r.rows.map((x) => ({
      at: x.at.toISOString(),
      login: x.login,
      role: x.role,
      action: x.action,
      field: x.field,
      oldValue: x.old_value,
      newValue: x.new_value,
      comment: x.comment,
      details: withoutCost(x.details),
    })),
  }, 200);
});
