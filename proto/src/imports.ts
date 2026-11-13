import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { uuid } from './domain/uuid.ts';

// N1 → M1: загрузка листа клиента и создание заказа.
//
// Это ПЕРВЫЙ шаг каждого из 11 процессов. В legacy данные приходили из 1С, и без
// публикации 1С заказ создать было нельзя — отсюда 12 пунктов в manual.md §6,
// которые «нельзя покрыть, потому что нужны данные».
//
// Здесь единственный вход данных в прототип (prototype-spec.md §6):
// seed/templates для справочников и этот эндпоинт для заказов.

export const imports = createApi();

const ImportRow = z.object({
  article: z.string().optional().describe('Артикул из заявки'),
  name: z.string().min(1).describe('Наименование «как написал клиент»'),
  qty: z.string().optional().describe('Количество текстом — клиент пишет по-разному'),
  unit: z.string().optional(),
  vehiclePlate: z.string().optional().describe('Госномер авто из заявки'),
  clientNumber: z.string().optional().describe('Номер заказа клиента'),
});

const ImportBody = z.object({
  customerId: uuid.describe('Заказчик (ref.counterparty)'),
  contractId: uuid.optional(),
  organizationId: uuid.optional(),
  operation: z.enum(['sale', 'purchase']).optional().default('sale'),
  rows: z.array(ImportRow).min(1).describe('Строки листа, минимум одна'),
});

const route = createRoute({
  method: 'post',
  path: '/imports',
  tags: ['imports'],
  summary: 'Создать заказ из листа клиента (N1 → M1)',
  request: { body: { content: { 'application/json': { schema: ImportBody } } } },
  responses: {
    201: {
      description: 'Заказ создан',
      content: {
        'application/json': {
          schema: z.object({
            orderId: uuid,
            number: z.string(),
            lineIds: z.array(uuid),
            total: z.number(),
          }),
        },
      },
    },
    400: { description: 'Нет строк или неизвестный заказчик' },
  },
});

imports.openapi(route, async (c) => {
  const body = c.req.valid('json');

  const customer = await pool.query(`select 1 from counterparty where id = $1 and deleted_at is null`, [body.customerId]);
  if (customer.rowCount === 0) {
    return problemResponse(c, new Problem(400, 'bad_request',
      `Заказчик ${body.customerId} не найден в справочнике`, 'customerId'));
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    // Номер заказа: последовательный, чтобы тест мог его предсказать.
    const seq = await client.query<{ n: string }>(
      `select (coalesce(max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::bigint), 0) + 1)::text as n
         from customer_order where number like 'ЗК-%'`,
    );
    const number = `ЗК-${String(seq.rows[0]!.n).padStart(4, '0')}`;
    const clientNumber = body.rows[0]?.clientNumber ?? null;

    const order = await client.query<{ id: string }>(
      `insert into customer_order (number, operation, client_order_number,
                                   counterparty_id, contract_id, organization_id, total)
       values ($1, $2, $3, $4, $5, $6, 0)
       returning id`,
      [number, body.operation, clientNumber, body.customerId,
        body.contractId ?? null, body.organizationId ?? null],
    );
    const orderId = order.rows[0]!.id;

    const lineIds: string[] = [];
    for (const row of body.rows) {
      const line = await client.query<{ id: string }>(
        `insert into line (customer_order_id, operation, status, customer_id, contract_id, order_date)
         values ($1, $2, 'new', $3, $4, current_date)
         returning id`,
        [orderId, body.operation, body.customerId, body.contractId ?? null],
      );
      const lineId = line.rows[0]!.id;
      lineIds.push(lineId);

      // Заявка «как написал клиент» — до сопоставления номенклатуры (M2).
      await client.query(
        `insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_unit, fact_article, vehicle_plate)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [lineId, row.clientNumber ?? clientNumber, row.name, row.qty ?? null,
          row.unit ?? null, row.article ?? null, row.vehiclePlate ?? null],
      );

      // Отметка создаётся снятой: её ставит оператор, а не загрузка.
      await client.query(`insert into line_mark (id, marked) values ($1, false)`, [lineId]);
    }

    await client.query('commit');

    return c.json({ orderId, number, lineIds, total: lineIds.length }, 201);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
