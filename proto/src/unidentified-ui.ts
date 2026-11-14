import { Hono } from 'hono';
import { pool } from './db.ts';
import { layout } from './views/html.ts';
import { unidentifiedSummary, unidentifiedTable, type Option, type UnidentifiedRow } from './views/unidentified.ts';

// Экран неопознанных: список и привязка номенклатуры (2 маршрута).
//
// `GET /unidentified` живёт здесь как ФУНКЦИЯ, а HTML отдаёт middleware в
// `server.ts`: адрес занят API-маршрутом, и второй адрес для того же ресурса
// разошёлся бы с первым (та же причина, что у `/fleet` и `/invoices`).

export const unidentifiedUi = new Hono();

/** Позиции, ждущие опознания: строки без номенклатуры. */
export async function loadUnidentified(): Promise<UnidentifiedRow[]> {
  const r = await pool.query<{
    id: string; status: string; quantity: string | null;
    fact_name: string | null; fact_article: string | null;
    plate: string | null; cell: string | null; comment: string | null;
  }>(
    `select l.id, l.status, l.quantity::text,
            f.fact_name, f.fact_article, f.vehicle_plate as plate,
            (select code from storage_cell c where c.id = l.cell_id) as cell,
            l.comment
       from line l
       left join line_fact f on f.id = l.id
      where not l.deleted and l.nomenclature_id is null
      order by l.order_date, l.id`,
  );

  return r.rows.map((x) => ({
    id: x.id, status: x.status, quantity: x.quantity,
    factName: x.fact_name, factArticle: x.fact_article,
    plate: x.plate, cell: x.cell, comment: x.comment,
  }));
}

/** Номенклатура для выбора при опознании. */
async function loadNomenclature(): Promise<Option[]> {
  const r = await pool.query<{ id: string; title: string }>(
    `select id, coalesce(article || ' — ', '') || name as title
       from nomenclature where deleted_at is null order by name`,
  );
  return r.rows;
}

/** Зоны, куда можно положить опознанную позицию. */
async function loadZones(): Promise<Option[]> {
  const r = await pool.query<{ id: string; title: string }>(
    `select id, name as title from warehouse_zone
      where deleted_at is null and purpose in ('storage', 'assembly', 'repair')
      order by sort`,
  );
  return r.rows;
}

async function panel(message?: string): Promise<string> {
  const [rows, nomenclatures, zones] = await Promise.all([
    loadUnidentified(), loadNomenclature(), loadZones(),
  ]);

  return `<div id="unidentified-panel" data-testid="unidentified-panel">
    ${message ? `<p class="hint-partial" data-testid="unidentified-message">${message}</p>` : ''}
    ${unidentifiedSummary(rows)}
    ${unidentifiedTable(rows, nomenclatures, zones)}
  </div>`;
}

/** Страница целиком. */
export async function unidentifiedPage(): Promise<string> {
  return layout({
    title: 'Неопознанные позиции',
    testId: 'page-unidentified',
    active: 'unidentified',
    body: `<p class="hint">Сюда попадают строки БЕЗ номенклатуры: пришло не то,
      что заказывали, или артикул не читается. Пока позиция не опознана, её нельзя
      ни зарезервировать, ни отгрузить.</p>
      ${await panel()}`,
  });
}

// --- POST /ui/unidentified/bind — опознать позицию (K8) ------------------------------

unidentifiedUi.post('/ui/unidentified/bind', async (c) => {
  const form = await c.req.parseBody();
  const lineId = String(form.lineId ?? '');
  const nomenclatureId = String(form.nomenclatureId ?? '');
  const zoneId = String(form.zoneId ?? '');

  // Делегируем ТОМУ ЖЕ адресу API, что и внешний клиент: логика сопоставления
  // остаётся в одном месте. Экран лишь передаёт запрос и перерисовывает список.
  const { app } = await import('./server.ts');
  const res = await app.request(`/lines/${lineId}/bind`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nomenclatureId, ...(zoneId ? { zoneId } : {}) }),
  });

  if (!res.ok) {
    const problem = (await res.json()) as { message?: string };
    return c.html(await panel(problem.message ?? 'Опознать не удалось'), res.status as 400);
  }

  const body = (await res.json()) as { nomenclature: string };
  return c.html(await panel(`Позиция опознана: ${body.nomenclature}.`));
});
