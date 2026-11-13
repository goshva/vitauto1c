import { Hono } from 'hono';
import { pool } from './db.ts';
import { linesPanel } from './lines-ui.ts';

// Действия цепочки на экране АРМ: загрузка листа, задание, размещение, канбан.
//
// Каждое возвращает ПАНЕЛЬ целиком, а не отдельный фрагмент: после действия
// меняются и строки, и доступные кнопки, и счётчик отметок. Подменять их по
// отдельности — значит держать логику пересчёта на клиенте, а её там быть не должно.

export const linesUiActions = new Hono();

const opOf = (v: unknown): string => (v === 'purchases' ? 'purchase' : 'sale');

/** Отмеченные строки в порядке обработки — так же, как их видит оператор. */
async function markedIds(): Promise<{ id: string; status: string }[]> {
  const r = await pool.query<{ id: string; status: string }>(
    `select l.id, l.status from line l
       join line_mark m on m.id = l.id and m.marked
      where not l.deleted
      order by l.order_date, l.id`,
  );
  return r.rows;
}

// --- M4, K5: задание «В работе» -------------------------------------------------------

linesUiActions.post('/ui/lines/job', async (c) => {
  const form = await c.req.parseBody();
  const op = opOf(form.view);
  const lines = await markedIds();

  // Из этих статусов задание забирает строки в закупку.
  const take = lines.filter((l) => ['new', 'in_work', 'ready_to_ship'].includes(l.status));
  for (const l of take) {
    await pool.query(
      `update line set status = 'ordered', version = version + 1, updated_at = now() where id = $1`,
      [l.id],
    );
    await pool.query(`update line_mark set marked = false where id = $1`, [l.id]);
  }

  if (take.length > 0) {
    await pool.query(
      `insert into supplier_order (number, operation, customer_order_id, counterparty_id, total)
       select 'ЗП-' || to_char(now(), 'YYYYMMDD-HH24MISS'), 'purchase', l.customer_order_id,
              (select id from counterparty where is_supplier and deleted_at is null limit 1), 0
         from line l where l.id = $1`,
      [take[0]!.id],
    );
  }

  return c.html(await linesPanel(op));
});

// --- M7, P2: канбан снабжения ---------------------------------------------------------

/** Статус канбана → (целевой статус строки, допустимые исходные). */
const SUPPLY: Record<string, { to: string; from: string[] }> = {
  paid: { to: 'paid', from: ['ordered'] },
  in_transit: { to: 'in_transit', from: ['paid'] },
  acceptance: { to: 'acceptance', from: ['in_transit'] },
  to_stock: { to: 'to_stock', from: ['acceptance'] },
  assembly: { to: 'assembly', from: ['to_stock', 'reserve'] },
  assembled: { to: 'ready_to_ship', from: ['assembly'] },
};

linesUiActions.post('/ui/lines/supply', async (c) => {
  const form = await c.req.parseBody();
  const op = opOf(form.view);
  const status = String(form.status ?? '');
  const rule = SUPPLY[status];

  if (!rule) {
    return c.html(
      (await linesPanel(op)).replace(
        '<div id="actions"',
        `<p class="hint-partial" data-testid="supply-error">Неизвестный статус снабжения</p><div id="actions"`,
      ),
    );
  }

  for (const l of await markedIds()) {
    if (!rule.from.includes(l.status)) continue;
    await pool.query(
      `update line set status = $2, version = version + 1, updated_at = now() where id = $1`,
      [l.id, rule.to],
    );
    await pool.query(`update line_mark set marked = false where id = $1`, [l.id]);
  }

  return c.html(await linesPanel(op));
});

// --- N1 → M1: загрузка листа ----------------------------------------------------------

linesUiActions.post('/ui/lines/import', async (c) => {
  const form = await c.req.parseBody();
  const op = opOf(form.view);

  const name = String(form.name ?? '').trim();
  if (!name) {
    return c.html(
      (await linesPanel(op)).replace(
        '<div id="actions"',
        `<p class="hint-partial" data-testid="import-error">Укажите наименование</p><div id="actions"`,
      ),
    );
  }

  const customer = await pool.query<{ id: string }>(
    `select id from counterparty where is_customer and deleted_at is null order by code limit 1`,
  );
  const contract = await pool.query<{ id: string }>(
    `select id from contract where deleted_at is null order by code limit 1`,
  );

  const order = await pool.query<{ id: string }>(
    `insert into customer_order (number, operation, client_order_number, counterparty_id, contract_id, total)
     values ('ЗК-' || to_char(now(), 'MMDD-HH24MISS'), 'sale', $1, $2, $3, 0) returning id`,
    [String(form.clientNumber ?? ''), customer.rows[0]!.id, contract.rows[0]!.id],
  );

  const line = await pool.query<{ id: string }>(
    `insert into line (customer_order_id, operation, status, customer_id, contract_id, order_date)
     values ($1, 'sale', 'new', $2, $3, current_date) returning id`,
    [order.rows[0]!.id, customer.rows[0]!.id, contract.rows[0]!.id],
  );

  await pool.query(
    `insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit)
     values ($1, $2, $3, $4, $5, $6)`,
    [line.rows[0]!.id, String(form.clientNumber ?? ''), name,
      String(form.qty ?? ''), String(form.article ?? ''), String(form.unit ?? '')],
  );
  await pool.query(`insert into line_mark (id, marked) values ($1, false)`, [line.rows[0]!.id]);

  return c.html(await linesPanel(op));
});
