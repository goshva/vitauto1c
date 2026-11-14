import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { uuid } from './domain/uuid.ts';

// Операции склада и задание. Канбан снабжения вынесен в `supply.ts`:
// файл перевалил за 200 строк, а в большом файле теряется контекст.
//
// Задание в legacy уходило в 1С; здесь оно выполняется целиком в приложении
// (prototype-spec.md §6: 1С вне контура). Логика та же: отмеченные строки
// переводятся в «Заказано», и на заказ создаётся заказ поставщику.

export const operations = createApi();

/** Статусы, из которых задание забирает строки в закупку. */
const JOB_FROM = ['new', 'in_work', 'ready_to_ship'];

const CELL_MISSING = new Problem(400, 'bad_request', 'Ячейка не найдена', 'cellId');

// --- K2: размещение строки в ячейку ---------------------------------------------------

const cellRoute = createRoute({
  method: 'post',
  path: '/lines/{id}/cell',
  tags: ['warehouse'],
  summary: 'Разместить строку в ячейке (K2)',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: z.object({ cellId: uuid }) } } },
  },
  responses: {
    200: { description: 'Размещено', content: { 'application/json': { schema: z.object({
      id: uuid, cell: z.string().nullable(), version: z.number(),
    }) } } },
    400: { description: 'Ячейка не найдена или заблокирована' },
    404: { description: 'Строка не найдена' },
  },
});

operations.openapi(cellRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { cellId } = c.req.valid('json');

  const cell = await pool.query<{ code: string; blocked: boolean }>(
    `select code, blocked from storage_cell where id = $1 and deleted_at is null`,
    [cellId],
  );
  if (cell.rowCount === 0) return problemResponse(c, CELL_MISSING);
  if (cell.rows[0]!.blocked) {
    return problemResponse(c, new Problem(400, 'bad_request',
      `Ячейка ${cell.rows[0]!.code} заблокирована`, 'cellId'));
  }

  const r = await pool.query<{ version: string }>(
    `update line set cell_id = $2, version = version + 1, updated_at = now()
      where id = $1 and not deleted
      returning version::text`,
    [id, cellId],
  );
  if (r.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }
  return c.json({ id, cell: cell.rows[0]!.code, version: Number(r.rows[0]!.version) }, 200);
});

// --- M4, K5: задание («В работе») -----------------------------------------------------

const jobRoute = createRoute({
  method: 'post',
  path: '/sales/jobs',
  tags: ['jobs'],
  summary: 'Задание: отмеченные строки в «Заказано», заказ поставщику (M4, K5)',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      allowSplit: z.boolean().optional().default(false),
    }) } } },
  },
  responses: {
    200: { description: 'Итог задания', content: { 'application/json': { schema: z.object({
      jobId: uuid, state: z.string(), processed: z.number(), total: z.number(),
      skipped: z.array(z.string()),
    }) } } },
    409: { description: 'Нет отмеченных строк' },
  },
});

interface MarkedForJob {
  id: string;
  status: string;
  order_id: string | null;
  name: string;
}

/** Переводит одну строку в «Заказано» и снимает отметку. */
async function takeToOrder(line: MarkedForJob): Promise<void> {
  await pool.query(
    `update line set status = 'ordered', version = version + 1, updated_at = now() where id = $1`,
    [line.id],
  );
  await pool.query(`update line_mark set marked = false where id = $1`, [line.id]);
}

// АВТОСОЗДАНИЕ ЗАКАЗА ПОСТАВЩИКУ УБРАНО — решение заказчика (14.11.2026):
// «автосоздание заказа поставщику при проведении „Заказа клиента“ — отключаем
// полностью». ФТ v2 п. 3 говорит то же: «При проведении „Заказа клиента“ этот
// документ автоматически не создаётся».
//
// Здесь стояла функция `createSupplierOrder`, и «Задание» заводило по заказу
// поставщику на каждый заказ покупателя. Это и было автосоздание: оператор не
// просил — документ появлялся. Теперь заказ поставщику делает только явный вызов
// `POST /supplier-orders` по отмеченным строкам.
//
// Убрано именно СОЗДАНИЕ, а не тип документа: заказ поставщику остаётся, иначе
// снабжению не с чем работать (см. кнопку «Новая закупка» в рабочем месте).

operations.openapi(jobRoute, async (c) => {
  const marked = await pool.query<MarkedForJob>(
    `select l.id, l.status, l.customer_order_id as order_id,
            coalesce(f.fact_name, l.id::text) as name
       from line l
       join line_mark m on m.id = l.id and m.marked
       left join line_fact f on f.id = l.id
      where not l.deleted
      order by l.order_date, l.id`,
  );

  if (marked.rowCount === 0) {
    return problemResponse(c, new Problem(409, 'nothing_marked',
      'Нет отмеченных строк в статусах «Новый», «В работе», «Готово к отгрузке».'));
  }

  const job = await pool.query<{ id: string }>(
    `insert into job (kind, state) values ('in_work', 'running') returning id`,
  );
  const jobId = job.rows[0]!.id;

  const skipped: string[] = [];
  let processed = 0;

  for (const line of marked.rows) {
    if (!JOB_FROM.includes(line.status)) {
      skipped.push(`${line.name}: из статуса «${line.status}» задание не берёт строки`);
      continue;
    }
    await takeToOrder(line);
    processed++;
  }

  await pool.query(`update job set state = 'done', processed = true, finished_at = now() where id = $1`, [jobId]);

  // `supplierOrderId` из ответа УБРАН вместе с автосозданием. Поле, которое
  // всегда null, хуже отсутствующего: клиент ждёт значение и не понимает, почему
  // его нет. Заказ поставщику теперь заводится отдельно — `POST /supplier-orders`.
  return c.json({
    jobId, state: 'done', processed, total: marked.rowCount!, skipped,
  }, 200);
});
