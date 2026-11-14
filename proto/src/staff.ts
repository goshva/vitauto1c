import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { createApi } from './api.ts';
import { uuid } from './domain/uuid.ts';
import { ROLES, roleTitle } from './domain/roles.ts';

// Сотрудники (Q3, Q7): кто выполняет работы и кто подписывает акт (1 операция).
//
// Сотрудник — не роль. Роль даёт права доступа, а в акте стоит ПОДПИСЬ конкретного
// человека, и выработка считается по нему же: «Петров выполнил 12 работ за месяц».
// Поэтому `employee` — отдельная сущность, а не значение роли.

export const staff = createApi();

const EmployeeSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  role: z.string(),
  roleTitle: z.string().describe('Название роли для оператора'),
  roleDuty: z.string().describe('Что роль делает — для отчёта о правах'),
  departmentId: z.string().nullable(),
  department: z.string().nullable(),
  position: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  canSign: z.boolean().describe('Может подписывать акт выполненных работ'),
});

staff.openapi(createRoute({
  method: 'get',
  path: '/employees',
  tags: ['staff'],
  summary: 'Сотрудники: ФИО, роль, подразделение, право подписи',
  request: { query: z.object({
    role: z.string().optional(),
    departmentId: uuid.optional(),
    canSign: z.enum(['true', 'false']).optional(),
  }) },
  responses: {
    200: { description: 'Список сотрудников', content: { 'application/json': { schema: z.object({
      items: z.array(EmployeeSchema),
      total: z.number().int(),
      roles: z.array(z.object({ role: z.string(), title: z.string(), duty: z.string() })),
    }) } } },
  },
}), async (c) => {
  const q = c.req.valid('query');

  const parts: string[] = [];
  const params: unknown[] = [];
  if (q.role) { params.push(q.role); parts.push(`e.role = $${params.length}`); }
  if (q.departmentId) { params.push(q.departmentId); parts.push(`e.department_id = $${params.length}`); }
  if (q.canSign) { params.push(q.canSign === 'true'); parts.push(`e.can_sign = $${params.length}`); }

  const r = await pool.query<{
    id: string; full_name: string; role: string; department_id: string | null;
    department: string | null; position: string | null; phone: string | null;
    email: string | null; can_sign: boolean;
  }>(
    `select e.id, e.full_name, e.role, e.department_id, d.name as department,
            e.position, e.phone, e.email, e.can_sign
       from employee e
       left join department d on d.id = e.department_id and d.deleted_at is null
      where e.deleted_at is null
        ${parts.length ? `and ${parts.join(' and ')}` : ''}
      order by e.full_name`,
    params,
  );

  return c.json({
    items: r.rows.map((x) => ({
      id: x.id, fullName: x.full_name, role: x.role,
      roleTitle: roleTitle(x.role), roleDuty: ROLES[x.role as keyof typeof ROLES]?.duty ?? '',
      departmentId: x.department_id, department: x.department,
      position: x.position, phone: x.phone, email: x.email, canSign: x.can_sign,
    })) as never[],
    total: r.rowCount ?? 0,
    // Роли отдаются вместе со списком: экран прав строится по ним, а не по
    // встреченным в данных значениям — иначе новая роль не появится, пока
    // никого на неё не назначили.
    roles: Object.entries(ROLES).map(([role, spec]) => ({ role, title: spec.title, duty: spec.duty })) as never[],
  }, 200);
});
