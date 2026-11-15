import { Hono } from 'hono';
import { pool } from './db.ts';
import { guard, userIdOf } from './auth.ts';
import { problemResponse } from './problem.ts';
import { parsePasted, templateText } from './import-template.ts';
import { importPanel } from './views/import-paste.ts';

// Заявка из буфера обмена и шаблон для неё (ФТ v2 п. 8).
//
// «Заявка вставляется из буфера обмена (Ctrl+V) построчно, без порчи чисел. В шапке
// документа — поля „Гос. номер“, флажок „Срочно“, поле „База“».
//
// Порядок работы задуман такой: оператор скачивает ШАБЛОН, заполняет его в Excel —
// или прямо в буфере, — и вставляет ЦЕЛИКОМ, вместе с шапкой. Разбор шапку распознаёт
// и пропускает, поэтому «вырезать заголовки» не нужно.

export const importPaste = new Hono();

// --- GET /ui/lines/template — отдать шаблон файлом -----------------------------------
//
// Файлом, а не текстом на экране: заполняют его в Excel, а оттуда копируют.
// Копирование с экрана сохранило бы разметку и разделило колонки пробелами.
importPaste.get('/ui/lines/template', (c) => {
  // BOM и `;` — см. `templateText()`: без них Excel в русской локали складывает
  // весь файл в одну колонку и ломает кириллицу.
  return c.body(templateText(), 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="zayavka-template.csv"',
  });
});

// --- GET /ui/lines/paste-form — открыть форму вставки --------------------------------
importPaste.get('/ui/lines/paste-form', async (c) => c.html(await importPanel(templateText())));

// --- POST /ui/lines/paste — разобрать и создать заказ --------------------------------
importPaste.post('/ui/lines/paste', async (c) => {
  const noRight = guard(c, 'request.create');
  if (noRight) return problemResponse(c, noRight);

  const form = await c.req.parseBody();
  const text = String(form.pasted ?? '');
  const customerId = String(form.customerId ?? '');

  const { rows, errors } = parsePasted(text);

  if (rows.length === 0) {
    return c.html(await importPanel(text, errors.length > 0
      ? errors
      : ['Ни одной строки с наименованием и количеством.']), 400);
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    // Заказ один на всю вставку: «Заказ клиента» — документ, а не набор строк.
    const seq = await client.query<{ n: string }>(
      `select (coalesce(max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::bigint), 0) + 1)::text as n
         from customer_order where number like 'ЗК-%'`,
    );
    const number = `ЗК-${String(seq.rows[0]!.n).padStart(4, '0')}`;

    const order = await client.query<{ id: string }>(
      `insert into customer_order (number, operation, client_order_number, counterparty_id,
                                   organization_id, total, author_id)
       values ($1, 'sale', $2, $3, '55555555-5555-5555-5555-555555555501', 0, $4)
       returning id`,
      [number, rows[0]!.clientNumber, customerId || null, userIdOf(c)],
    );
    const orderId = order.rows[0]!.id;

    for (const row of rows) {
      const id = await client.query<{ id: string }>(
        `insert into line (customer_order_id, operation, status, quantity, order_date,
                           nomenclature_id, comment, urgency, territory, internal_order_number)
         values ($1, 'sale', 'new', $2, current_date,
                 (select id from nomenclature
                   where deleted_at is null and (article = $3 or name = $4) limit 1),
                 null, $5, $6, $7)
         returning id`,
        [orderId, row.quantity, row.article, row.name,
          row.urgent ? 'Срочно' : null, row.base, `ВИТ-${number}`],
      );
      const lineId = id.rows[0]!.id;

      // Факт заявки: как написал клиент, гос. номер и единица. Это то, что видит
      // оператор, когда позиция ещё не сопоставлена с номенклатурой.
      await client.query(
        `insert into line_fact (id, fact_name, fact_qty, fact_unit, vehicle_plate,
                                client_order_number)
         values ($1, $2, $3, $4, $5, $6)`,
        [lineId, row.name, row.quantity, row.unit, row.plate, row.clientNumber],
      );
      await client.query(`insert into line_mark (id, marked) values ($1, false)`, [lineId]);
    }

    await client.query('commit');
    return c.html(await importPanel(templateText(), errors, {
      number, lines: rows.length,
    }));
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
