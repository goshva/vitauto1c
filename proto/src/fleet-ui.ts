import { Hono } from 'hono';
import { pool } from './db.ts';
import { layout } from './views/html.ts';
import { fleetCard, fleetTable, type FleetRow } from './views/fleet.ts';
import { LIST_SQL, toItem, whereOf, type CarRow } from './fleet-query.ts';

// Экраны автопарка (4 маршрута): список, список ТО, карточка, отметка о ТО.
//
// Порядок регистрации важен: `/fleet/maintenance` стоит ДО `/fleet/:id`, иначе
// «maintenance» попадёт в параметр идентификатора, и список ТО отдаст 404.
// Та же ловушка, что у `/lines/summary` и `/lines/{id}`.

export const fleetUi = new Hono();

/**
 * Строка запроса → строка экрана.
 *
 * Не экспортируется: HTML теперь отдаёт middleware в `server.ts`, и наружу нужен
 * только готовый список (`loadFleet`). Отдельный адрес для экрана не заводится —
 * он разошёлся бы с API.
 */
const toFleetRow = (x: CarRow, now: Date): FleetRow => {
  const item = toItem(x, now);
  return {
    id: item.id, code: item.code, name: item.name, department: item.department,
    plate: item.plate, mileage: item.mileage, status: item.status,
    statusTitle: item.statusTitle, due: item.due,
  };
};

export async function loadFleet(query: { status?: string; departmentId?: string } = {}): Promise<FleetRow[]> {
  const { sql, params } = whereOf(query);
  const r = await pool.query<CarRow>(`${LIST_SQL}${sql} order by c.code`, params);

  const now = new Date();
  return r.rows.map((x) => toFleetRow(x, now));
}

/** Список ТО: только те, кому пора, и только не списанные. */
async function loadDue(): Promise<FleetRow[]> {
  const all = await loadFleet();
  return all.filter((c) => c.due.due && c.status !== 'written_off');
}

/**
 * Страница автопарка целиком.
 *
 * Экспортируется, потому что её отдаёт МАРШРУТ API (`fleet.ts`) при запросе HTML —
 * тот же приём, что у `/lines`: адрес `/fleet` один и для браузера, и для агента,
 * а формат выбирается по `Accept`. Второй адрес для того же ресурса разошёлся бы
 * с первым.
 */
export function fleetPage(rows: FleetRow[], query: { status?: string }): string {
  const filter = query.status
    ? `<p class="hint" data-testid="fleet-filter">Показано: ${rows.length}. <a href="/fleet">Показать все</a></p>`
    : '';

  return layout({
    active: 'fleet',
    title: 'Автопарк',
    testId: 'page-fleet',
    body: `<p class="hint" data-testid="fleet-summary">
    Машин: <strong>${rows.length}</strong> ·
    требуют ТО: <strong>${rows.filter((c) => c.due.due && c.status !== 'written_off').length}</strong> ·
    <a href="/fleet/maintenance" data-testid="link-maintenance">Список ТО</a>
  </p>
  ${filter}
  ${fleetTable(rows)}`,
  });
}

// --- GET /fleet/maintenance — ДО /fleet/:id ------------------------------------------

fleetUi.get('/fleet/maintenance', async (c) => {
  const rows = await loadDue();
  return c.html(layout({
    active: 'fleet',
    title: 'Регламентное ТО',
    testId: 'page-maintenance',
    body: `<p class="hint">Машины, которым пора на ТО, с причиной:
      сработал интервал пробега, истёк календарный срок или ТО не делали ни разу.</p>
      ${fleetTable(rows)}
      <p><a href="/fleet">← Весь автопарк</a></p>`,
  }));
});

/**
 * Карточка ТС или `null`, если машины нет.
 *
 * Отдаётся маршрутом API `/fleet/{id}` при запросе HTML — формат выбирается
 * по `Accept`, как у `/lines` и `/fleet`.
 */
export async function fleetCardPage(id: string): Promise<string | null> {
  const r = await pool.query<CarRow>(`${LIST_SQL} and c.id = $1`, [id]);
  if (r.rowCount === 0) return null;

  const item = toItem(r.rows[0]!, new Date());
  const wo = await pool.query<{ id: string; number: string | null; date: Date; status: string; total: string | null }>(
    `select id, number, date, status, total::text from work_order
      where car_id = $1 and deleted_at is null order by date desc limit 50`,
    [id],
  );

  return layout({
    active: 'fleet',
    title: `${item.code ?? 'ТС'} — ${item.name}`,
    testId: 'page-fleet-card',
    body: `<div id="fleet-panel">
      ${fleetCard(item as never, wo.rows.map((x) => ({ ...x, date: x.date.toISOString().slice(0, 10) })))}
    </div>
    <p><a href="/fleet">← Весь автопарк</a> · <a href="/fleet/maintenance">Список ТО</a></p>`,
  });
}

/** Страница «машина не найдена». */
export const fleetMissingPage = (id: string): string => layout({
  active: 'fleet',
  title: 'Машина не найдена',
  testId: 'page-fleet-missing',
  body: `<p data-testid="fleet-error">Машины с идентификатором «${id}» нет.</p>
    <p><a href="/fleet">← Весь автопарк</a></p>`,
});

// --- POST /ui/fleet/service — отметить ТО выполненным --------------------------------

fleetUi.post('/ui/fleet/service', async (c) => {
  const form = await c.req.parseBody();
  const carId = String(form.carId ?? '');

  const found = await pool.query<{ mileage: number | null }>(
    `select mileage from car where id = $1 and deleted_at is null`, [carId],
  );
  if (found.rowCount === 0) {
    return c.html('<div id="fleet-panel"><p data-testid="fleet-error">Машина не найдена.</p></div>', 404);
  }

  // Точка отсчёта сдвигается на ТЕКУЩИЙ пробег и текущую дату. Считается сервером,
  // а не клиентом: иначе экран и отчёт показывали бы разные сроки.
  await pool.query(
    `update car set mileage_at_service = coalesce(mileage, 0), last_service_at = now(),
                     version = version + 1, updated_at = now()
      where id = $1`,
    [carId],
  );

  const rows = await loadFleet();
  return c.html(`<div id="fleet-panel" data-testid="fleet-panel">
    <p class="hint-partial" data-testid="service-done-ok">ТО отмечено: срок отсчитывается от текущего пробега.</p>
    ${fleetPage(rows, {})}
  </div>`);
});
