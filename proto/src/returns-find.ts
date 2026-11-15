import { Hono } from 'hono';
import { pool } from './db.ts';
import { guard } from './auth.ts';
import { problemResponse } from './problem.ts';
import { layout, esc } from './views/html.ts';
import { returnsFindPanel, type FoundLine } from './views/returns-find.ts';

// Подбор проданного для возврата БЕЗ сопроводительных документов (БТ п. 18).
//
// «При возврате без документов кладовщик самостоятельно **визуально идентифицирует**
// деталь. Заявку на возврат поставщику может оформить как менеджер, так и кладовщик».
//
// ЗАЧЕМ ЭКРАН. Клиент приносит деталь без бумаг — и кладовщику нечего отметить в
// списке строк: он не знает, какая из них эта. Он опознаёт её ГЛАЗАМИ (по виду,
// артикулу, гос. номеру машины) и должен найти соответствующую ПРОДАННУЮ строку.
// Обычный список строк для этого не годится: он показывает и непроданное тоже.
//
// Поэтому здесь отдельный отбор по проданному: гос. номер, наименование, артикул,
// заказчик, дата отгрузки. Условия собирает ТОТ ЖЕ `buildFilter`, что и список: две
// копии правил отбора разошлись бы.

export const returnsFind = new Hono();

/** Состояния ПРОДАННОГО: вернуть можно то, что уехало клиенту. */
const SOLD = ['shipped', 'closed'];

interface FindQuery {
  plate?: string; name?: string; article?: string; customer?: string;
  dateFrom?: string; dateTo?: string;
}

async function search(q: FindQuery): Promise<FoundLine[]> {
  const params: unknown[] = [SOLD];
  const parts = [
    "v.operation = 'sale'",
    // `return_id` есть у строки, но НЕ в представлении. Подзапрос дешевле, чем
    // пересобирать `line_view` ради одного поля — так же сделано для вариантов
    // поставки в списке строк.
    `not exists (select 1 from line l2 where l2.id = v."id" and l2.return_id is not null)`,
  ];

  const sub = (columns: string[], value: string | undefined): void => {
    if (!value) return;
    params.push(`%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const n = params.length;
    parts.push(`(${columns.map((c) => `${c} ilike $${n}`).join(' or ')})`);
  };

  // Гос. номер лежит в атрибутах машины, а не в строке: кладовщик опознаёт деталь
  // по машине, с которой её сняли, и это самый надёжный признак.
  sub(['plate', 'vin', 'brand', 'model'], q.plate);
  sub(['"factName"', '"nomenclature"'], q.name);
  sub(['"nomenclatureArticle"', '"nomenclatureCode"'], q.article);
  sub(['customer'], q.customer);

  if (q.dateFrom) { params.push(q.dateFrom); parts.push(`"shipmentDate" >= $${params.length}::date`); }
  if (q.dateTo) { params.push(q.dateTo); parts.push(`"shipmentDate" < ($${params.length}::date + 1)`); }

  const r = await pool.query<{
    id: string; order: number; fact_name: string | null; nomenclature: string | null;
    article: string | null; customer: string | null; plate: string | null;
    shipment_date: string | null; quantity: string | null; status: string;
  }>(
    `select v."id", v."order", v."factName" as fact_name, v."nomenclature",
            v."nomenclatureArticle" as article, v.customer, v.plate,
            to_char(v."shipmentDate", 'DD.MM.YYYY') as shipment_date,
            v.quantity::text, v.status
       from line_view v
      where v.status = any($1) and ${parts.join(' and ')}
      order by v."shipmentDate" desc nulls last, v."order"
      limit 100`,
    params,
  );

  return r.rows.map((x) => ({
    id: x.id,
    order: x.order,
    name: x.fact_name ?? x.nomenclature ?? '—',
    article: x.article,
    customer: x.customer,
    plate: x.plate,
    shippedAt: x.shipment_date,
    quantity: x.quantity,
    status: x.status,
  }));
}

/** Экран подбора. */
export async function findPage(q: FindQuery = {}): Promise<string> {
  return layout({
    title: 'Подбор для возврата',
    testId: 'page-returns-find',
    active: 'documents',
    body: `<p class="hint" data-testid="find-hint">
      Клиент принёс деталь без документов — найдите её по машине, названию или
      артикулу. Показано только <strong>проданное</strong>: вернуть можно то,
      что уехало клиенту.
    </p>${returnsFindPanel(await search(q), q)}`,
  });
}

// --- GET /returns/find — экран -------------------------------------------------------
returnsFind.get('/returns/find', async (c) => {
  const noRight = guard(c, 'return.create');
  if (noRight) return problemResponse(c, noRight);
  return c.html(await findPage(c.req.query()));
});

// --- GET /ui/returns/find — только список --------------------------------------------
returnsFind.get('/ui/returns/find', async (c) => {
  const noRight = guard(c, 'return.create');
  if (noRight) return problemResponse(c, noRight);
  return c.html(returnsFindPanel(await search(c.req.query()), c.req.query()));
});

// --- POST /ui/returns/from-found — оформить возврат по найденному --------------------
//
// ДЕЛЕГИРУЕТ в API: отметки ставит сам, а создание возврата живёт в одном месте.
// Копия здесь разошлась бы с `POST /returns` в нумерации, состояниях и авторе.
returnsFind.post('/ui/returns/from-found', async (c) => {
  const noRight = guard(c, 'return.create');
  if (noRight) return problemResponse(c, noRight);

  const form = await c.req.parseBody({ all: true });
  const raw = form.lineId;
  const ids = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
    .map((x) => String(x)).filter((x) => x !== '');

  if (ids.length === 0) {
    return c.html(
      `<div id="find-panel" data-testid="find-panel">
        <p class="hint-partial" data-testid="find-nothing-marked">
          Ничего не отмечено. Поставьте галочки у деталей, которые клиент принёс.
        </p>
      </div>`, 400);
  }

  // Отмечаем ИМЕННО найденные строки: создание возврата работает по отметкам, а в
  // списке строк могли остаться чужие отметки от прошлых действий.
  await pool.query(`update line_mark set marked = false where marked`);
  await pool.query(
    `insert into line_mark (id, marked)
     select id, true from line where id = any($1::uuid[]) and not deleted
     on conflict (id) do update set marked = true`,
    [ids],
  );

  const { app } = await import('./server.ts');
  const res = await app.request('/returns', {
    method: 'POST',
    // СЕССИЮ ПЕРЕДАЁМ ЯВНО. `app.request` — внутренний вызов, и кука сама не
    // доедет: без этой строки возврат создавался бы БЕЗ АВТОРА, и «кто принял
    // деталь» осталось бы без ответа. Поймано тестом на запись автора.
    headers: {
      'content-type': 'application/json',
      ...(c.req.header('cookie') ? { cookie: c.req.header('cookie')! } : {}),
      ...(c.req.header('x-role') ? { 'x-role': c.req.header('x-role')! } : {}),
    },
    body: JSON.stringify({ kind: 'client' }),
  });

  if (!res.ok) {
    const problem = (await res.json()) as { message?: string };
    return c.html(
      `<div id="find-panel" data-testid="find-panel">
        <p class="hint-partial" data-testid="find-error">${
        problem.message ?? 'Возврат не оформлен'}</p>
      </div>`, res.status as 400);
  }

  const body = (await res.json()) as { number: string; lines: number };
  return c.html(
    `<div id="find-panel" data-testid="find-panel">
      <p class="hint" data-testid="find-done">
        Возврат <strong>${esc(body.number)}</strong> оформлен: строк ${body.lines}.
        Смотрите в <a href="/documents/returns">документах</a>.
      </p>
    </div>`,
  );
});
