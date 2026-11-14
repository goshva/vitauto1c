import { Hono } from 'hono';
import { pool } from './db.ts';
import { guard, roleOf } from './auth.ts';
import { problemResponse } from './problem.ts';
import { purchasePanel } from './views/purchase.ts';

// «Новая закупка» из рабочего места снабжения (ФТ v2 п. 16).
//
// Решение заказчика (14.11.2026): «кнопка должна быть в рабочем месте снабжения и
// администратора; право вшито в роль менеджера и администратора».
//
// ПОЧЕМУ ОТДЕЛЬНАЯ ФОРМА, А НЕ КНОПКА «СОЗДАТЬ ЗАКАЗ». Заказ поставщику можно было
// создать и раньше — по отмеченным строкам, с поставщиком из строки. Но у одной
// позиции бывает ТРИ поставщика и разные цены, и выбрать «на глаз» не выйдет: цены
// менялись, а помнит их только база. Форма собирает в одном месте то, что иначе
// сверяли бы вручную: у кого брали, по какой цене, что есть на складе и чем можно
// заменить.

export const purchaseUi = new Hono();

/** Строка, для которой снабженец собирается закупать. */
async function markedLine(): Promise<{
  id: string; nomenclature_id: string | null;
  fact_name: string | null; nomenclature: string | null; article: string | null;
} | null> {
  const r = await pool.query<{
    id: string; nomenclature_id: string | null;
    fact_name: string | null; nomenclature: string | null; article: string | null;
  }>(
    `select l.id, l.nomenclature_id, f.fact_name, n.name as nomenclature, n.article
       from line l
       join line_mark m on m.id = l.id and m.marked
       left join line_fact f on f.id = l.id
       left join nomenclature n on n.id = l.nomenclature_id and n.deleted_at is null
      where not l.deleted
      order by l.order_date, l.id
      limit 1`,
  );
  return r.rows[0] ?? null;
}

/** Панель закупки для отмеченной строки. */
export async function purchaseForm(): Promise<string> {
  const line = await markedLine();
  if (!line) {
    return '<div id="purchase-panel" data-testid="purchase-panel">' +
      '<p class="hint-partial" data-testid="purchase-note">Отметьте строку — покажу, у кого её брали.</p></div>';
  }

  const suppliers = await pool.query<{ id: string; name: string; purchases: string }>(
    `select cp.id, cp.name,
            (select count(*) from line l where l.supplier_id = cp.id and not l.deleted)::text as purchases
       from counterparty cp
      where cp.deleted_at is null and cp.is_supplier
      order by cp.name`,
  );

  const history = line.nomenclature_id
    ? (await pool.query<{
        supplier: string | null; price: string | null; date: string | null; number: string | null;
      }>(
        `select cp.name as supplier, l.cost_price::text as price,
                to_char(l.order_date, 'DD.MM.YYYY') as date, so.number
           from line l
           left join counterparty cp on cp.id = l.supplier_id and cp.deleted_at is null
           left join supplier_order so on so.id = l.supplier_order_id and so.deleted_at is null
          where l.nomenclature_id = $1 and not l.deleted and l.supplier_id is not null
          order by l.order_date desc nulls last, l.id desc
          limit 5`,
        [line.nomenclature_id],
      )).rows
    : [];

  const analogs = line.nomenclature_id
    ? (await pool.query<{ id: string; name: string; article: string | null; on_hand: string }>(
        `select n.id, n.name, n.article,
                coalesce((select sum(sb.on_hand) from stock_balance sb
                           where sb.nomenclature_id = n.id), 0)::text as on_hand
           from nomenclature n
          where n.deleted_at is null and n.id <> $1
            and (n.analog_id = $1
                 or n.id = (select analog_id from nomenclature where id = $1))
          order by n.name limit 5`,
        [line.nomenclature_id],
      )).rows
    : [];

  return purchasePanel({
    lineId: line.id,
    title: line.nomenclature ?? line.fact_name ?? 'Позиция без номенклатуры',
    article: line.article,
    // Без номенклатуры закупать нечего: сначала опознание (K8, A1).
    identified: line.nomenclature_id !== null,
    suppliers: suppliers.rows.map((s) => ({
      id: s.id, name: s.name, purchases: Number(s.purchases),
    })),
    history: history.map((h) => ({
      supplier: h.supplier, price: h.price, date: h.date, number: h.number,
    })),
    analogs: analogs.map((a) => ({
      id: a.id, name: a.name, article: a.article, onHand: a.on_hand,
    })),
  });
}

// --- GET /ui/supply/new-purchase — открыть форму -------------------------------------
purchaseUi.get('/ui/supply/new-purchase', async (c) => {
  // Право вшито в роли (ФТ v2 п. 16): закупку делает менеджер и администратор.
  const noRight = guard(c, 'purchase.create');
  if (noRight) {
    return c.html(
      `<div id="purchase-panel" data-testid="purchase-panel">
        <p class="hint-partial" data-testid="purchase-denied">${noRight.message}</p>
      </div>`,
      noRight.status as 403,
    );
  }
  return c.html(await purchaseForm());
});

// --- POST /ui/supply/purchase — создать закупку --------------------------------------
purchaseUi.post('/ui/supply/purchase', async (c) => {
  const noRight = guard(c, 'purchase.create');
  if (noRight) return problemResponse(c, noRight);

  const form = await c.req.parseBody();
  const supplierId = String(form.supplierId ?? '');
  const lineId = String(form.lineId ?? '');

  if (!supplierId) {
    return c.html(await purchaseForm(), 400);
  }

  // Отмечаем ИМЕННО эту строку: заказ поставщику строится по отмеченным, а отметок
  // в списке могло остаться несколько от прошлых действий.
  await pool.query(`update line_mark set marked = (id = $1) where id in
    (select id from line_mark where marked or id = $1)`, [lineId]);
  await pool.query(
    `insert into line_mark (id, marked) values ($1, true)
     on conflict (id) do update set marked = true`, [lineId]);

  const { app } = await import('./server.ts');
  const res = await app.request('/supplier-orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-role': roleOf(c) },
    body: JSON.stringify({ supplierId }),
  });

  if (!res.ok) {
    const problem = (await res.json()) as { message?: string };
    return c.html(
      `<div id="purchase-panel" data-testid="purchase-panel">
        <p class="hint-partial" data-testid="purchase-error">${problem.message ?? 'Закупка не создалась'}</p>
      </div>`,
      res.status as 400,
    );
  }

  const body = (await res.json()) as { number: string; lines: number };
  return c.html(
    `<div id="purchase-panel" data-testid="purchase-panel">
      <p class="hint" data-testid="purchase-done">
        Закупка <strong>${body.number}</strong> создана: строк ${body.lines}.
      </p>
    </div>`,
  );
});
