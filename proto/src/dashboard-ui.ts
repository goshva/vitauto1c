import { Hono } from 'hono';
import { pool } from './db.ts';
import { layout } from './views/html.ts';
import { wantsHtml } from './negotiate.ts';
import { guard } from './auth.ts';
import { problemResponse } from './problem.ts';
import { LIST_SQL, toItem, type CarRow } from './fleet-query.ts';

// Дашборд администратора (P1): один экран, по которому видно состояние работы.
//
// Домашний экран роли `admin` — по Q7 «admin видит дашборд». Остальным ролям он
// закрыт: их домашние экраны — списки, а не сводка.
//
// Счётчики считаются ЗАПРОСАМИ, а не берутся из кэша: на приёмочном стенде данные
// меняются руками, и «сводка вчерашнего дня» выглядела бы как поломка.

export const dashboardUi = new Hono();

interface Counters {
  lines: number;
  linesNew: number;
  fleetTotal: number;
  fleetDue: number;
  invoices: number;
  unpaid: string;
  workOrdersOpen: number;
}

async function counters(): Promise<Counters> {
  const q = async (sql: string): Promise<string> =>
    (await pool.query<{ v: string }>(sql)).rows[0]!.v;

  const cars = await pool.query<CarRow>(`${LIST_SQL}`, []);
  const now = new Date();
  const due = cars.rows
    .map((x) => toItem(x, now))
    .filter((x) => x.due.due && x.status !== 'written_off').length;

  return {
    lines: Number(await q(`select count(*)::text v from line where not deleted`)),
    linesNew: Number(await q(`select count(*)::text v from line where not deleted and status = 'new'`)),
    fleetTotal: cars.rowCount ?? 0,
    fleetDue: due,
    invoices: Number(await q(`select count(*)::text v from invoice where deleted_at is null`)),
    unpaid: await q(`select coalesce(sum(amount), 0)::text v from invoice
                      where deleted_at is null and status <> 'paid'`),
    workOrdersOpen: Number(await q(`select count(*)::text v from work_order
                                     where deleted_at is null and status <> 'closed'`)),
  };
}

function card(testId: string, title: string, value: string, hint: string, href?: string): string {
  const body = `<strong data-testid="${testId}">${value}</strong>
    <span class="dash-title">${title}</span>
    <span class="dash-hint">${hint}</span>`;
  return href
    ? `<a class="dash-card" href="${href}">${body}</a>`
    : `<div class="dash-card">${body}</div>`;
}

async function dashboardBody(): Promise<string> {
  const k = await counters();

  return `<p class="hint">Сводка по работе: строки, автопарк, счета, наряды.
    Обновляется при каждом открытии — данные на стенде меняются руками.</p>
  <div class="dash">
    ${card('dash-lines', 'строк в работе', String(k.lines), `из них новых: ${k.linesNew}`, '/lines')}
    ${card('dash-fleet-due', 'машин требуют ТО', String(k.fleetDue), `всего в автопарке: ${k.fleetTotal}`, '/fleet/maintenance')}
    ${card('dash-invoices', 'счетов выставлено', String(k.invoices), `не оплачено на ${k.unpaid} ₽`, '/invoices')}
    ${card('dash-work-orders', 'нарядов открыто', String(k.workOrdersOpen), 'в работе или ждут закрытия')}
  </div>
  <p class="hint">Быстрые переходы:
    <a href="/fleet">Автопарк</a> · <a href="/stock">Склад</a> ·
    <a href="/processes">Карта процессов</a></p>`;
}

// `GET /` — домашний экран администратора. Роль проверяется здесь же: дашборд
// показывает себестоимость и суммы, и открывать его всем ролям нельзя.
dashboardUi.get('/', async (c) => {
  const noRight = guard(c, 'dashboard.view');
  if (noRight) {
    // Браузеру — страница с объяснением, агенту — problem+json.
    if (wantsHtml(c)) {
      return c.html(layout({
        active: 'dashboard',
        title: 'Нет доступа',
        testId: 'page-forbidden',
        body: `<p data-testid="forbidden">${noRight.message}</p>
          <p>Ваш домашний экран: <a href="/lines">строки</a>,
             <a href="/stock">склад</a>, <a href="/fleet">автопарк</a>.</p>`,
      }), 403);
    }
    return problemResponse(c, noRight);
  }

  return c.html(layout({
    active: 'dashboard',
    title: 'Сводка',
    testId: 'page-dashboard',
    body: await dashboardBody(),
  }));
});
