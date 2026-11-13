import { Hono } from 'hono';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { PRINT_KINDS, printPage, type PrintRow } from './views/print.ts';

// Печать (решение Q4: серверный рендер).
//
// Два входа в одну и ту же форму:
//   GET  /print/{kind}      — ссылка из АРМ и Playwright: браузер получает HTML
//   POST /print             — совместимость с legacy (`{kind, customerOrderIds}`)
//
// Разные входы, один рендер: иначе «ссылка печатает одно, а кнопка другое» —
// классический расход двух реализаций одной формы.

export const print = new Hono();

/** Строки для формы: отбор по статусам вида печати. */
async function loadRows(kinds: string[], orderId?: string): Promise<PrintRow[]> {
  const params: unknown[] = [kinds];
  let where = 'where status = any($1)';
  if (orderId) {
    params.push(orderId);
    where += ` and customer_order_id = $${params.length}`;
  }

  const r = await pool.query<PrintRow>(
    `select "stockCell", "nomenclatureArticle", "nomenclature", "factName", "batch",
            "nomenclatureUnit", "quantity", "salePrice", "saleSum", "customer",
            "internalOrderNumber"
       from line_view ${where}
      order by "order"`,
    params,
  );
  return r.rows;
}

/** Разбор вида печати. Неизвестный вид — 404 со списком допустимых. */
function resolveKind(raw: string): { key: string; kind: (typeof PRINT_KINDS)[string] } | Problem {
  const kind = PRINT_KINDS[raw];
  if (!kind) {
    return new Problem(404, 'not_found',
      `Формы «${raw}» нет. Допустимые: ${Object.keys(PRINT_KINDS).join(', ')}`);
  }
  return { key: raw, kind };
}

// --- GET /print/{kind} — форма по ссылке ----------------------------------------------

print.get('/print/:kind', async (c) => {
  const resolved = resolveKind(c.req.param('kind'));
  if (resolved instanceof Problem) return problemResponse(c, resolved);

  const rows = await loadRows(resolved.kind.statuses, c.req.query('order'));
  return c.html(printPage(resolved.key, resolved.kind, rows));
});

// --- POST /print — совместимость с legacy ---------------------------------------------

print.post('/print', async (c) => {
  const body = await c.req.parseBody();
  const raw = String(body.kind ?? '');

  const resolved = resolveKind(raw);
  if (resolved instanceof Problem) return problemResponse(c, resolved);

  const orderId = typeof body.order === 'string' && body.order ? body.order : undefined;
  const rows = await loadRows(resolved.kind.statuses, orderId);
  return c.html(printPage(resolved.key, resolved.kind, rows));
});
