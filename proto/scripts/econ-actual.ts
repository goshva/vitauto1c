import { pool } from '../src/db.ts';
import type { EconTotals } from '../src/domain/econ.ts';

// ФАКТ МЕСЯЦА: то, что реально лежит в базе после действий сотрудников.
//
// Два независимых источника, и это не дублирование:
//   • продажа запчастей — по правилу самого отчёта (`src/reports-data.ts:30-56`):
//     есть дата отгрузки и состояние не отменено;
//   • ремонт — по заказ-наряду: работы и запчасти закрытого наряда.
//
// ПОЧЕМУ РЕМОНТ СЧИТАЕТСЯ ОТДЕЛЬНО. Отчёт о прибыли требует дату отгрузки, а у
// заказ-наряда её нет: ремонт не отгружается, он выполняется. Значит выручка ремонта
// в отчёт не попадает вовсе — это проверяется тестом `econ-month.test.ts`, и это
// находка, а не особенность расчёта.

interface ActualFacts {
  /** Отгруженных строк продажи. */
  shippedLines: number;
  /** Закрытых заказ-нарядов. */
  closedOrders: number;
  /** Работ в закрытых нарядах. */
  works: number;
  /** Проведённых приёмок. */
  postedReceipts: number;
  /** Движений склада. */
  stockMoves: number;
  /** Выручка ремонта: работы и запчасти закрытых нарядов. */
  repairRevenue: number;
  /** Записей журнала по ролям: независимая мера действий. */
  journalByRole: Record<string, number>;
}

interface Actual {
  totals: EconTotals;
  facts: ActualFacts;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Продажа: ровно те строки, что берёт отчёт о прибыли. */
async function loadSalesTotals(): Promise<{ revenue: number; cost: number; units: number; lines: number }> {
  const r = await pool.query<{ revenue: string; cost: string; units: string; lines: string }>(
    `select coalesce(sum(quantity * "salePrice"), 0)::text as revenue,
            coalesce(sum(quantity * "costPrice"), 0)::text as cost,
            coalesce(sum(quantity), 0)::text as units,
            count(*)::text as lines
       from line_view
      where "shipmentDate" is not null
        and status not in ('cancelled', 'refused', 'return')`,
  );
  const row = r.rows[0]!;
  return {
    revenue: Number(row.revenue), cost: Number(row.cost),
    units: Number(row.units), lines: Number(row.lines),
  };
}

/** Ремонт: работы и запчасти закрытых нарядов. */
async function loadRepairTotals(): Promise<{
  partsRevenue: number; partsCost: number; units: number; lines: number;
  servicesRevenue: number; normHours: number; works: number; orders: number;
}> {
  const r = await pool.query<{
    parts_revenue: string; parts_cost: string; units: string; lines: string;
    services: string; norm_hours: string; works: string;
  }>(
    `select
        coalesce(sum(case when l.norm_hours is null
                          then coalesce(l.quantity,0) * coalesce(l.sale_price,0) end), 0)::text as parts_revenue,
        coalesce(sum(case when l.norm_hours is null
                          then coalesce(l.quantity,0) * coalesce(l.cost_price,0) end), 0)::text as parts_cost,
        coalesce(sum(case when l.norm_hours is null then coalesce(l.quantity,0) end), 0)::text as units,
        count(*) filter (where l.norm_hours is null)::text as lines,
        coalesce(sum(case when l.norm_hours is not null
                          then l.norm_hours * coalesce(l.sale_price,0) end), 0)::text as services,
        coalesce(sum(l.norm_hours), 0)::text as norm_hours,
        count(*) filter (where l.norm_hours is not null)::text as works
       from line l join work_order w on w.id = l.work_order_id
      where w.status = 'closed' and w.deleted_at is null and not l.deleted`,
  );
  const row = r.rows[0]!;
  const orders = await pool.query<{ n: string }>(
    `select count(*)::text as n from work_order where status = 'closed' and deleted_at is null`,
  );
  return {
    partsRevenue: Number(row.parts_revenue), partsCost: Number(row.parts_cost),
    units: Number(row.units), lines: Number(row.lines),
    servicesRevenue: Number(row.services), normHours: Number(row.norm_hours),
    works: Number(row.works), orders: Number(orders.rows[0]!.n),
  };
}

export async function loadActual(since: Date): Promise<Actual> {
  const sales = await loadSalesTotals();
  const repair = await loadRepairTotals();

  const moves = await pool.query<{ n: string }>(`select count(*)::text as n from stock_move`);
  const receipts = await pool.query<{ n: string }>(
    `select count(*)::text as n from receipt where posted and deleted_at is null`);
  const journal = await pool.query<{ role: string | null; n: string }>(
    `select role, count(*)::text as n from audit_log where at >= $1 group by role order by role`,
    [since],
  );

  const journalByRole: Record<string, number> = {};
  for (const row of journal.rows) journalByRole[row.role ?? '(нет роли)'] = Number(row.n);

  const partsRevenue = round2(sales.revenue + repair.partsRevenue);
  const partsCost = round2(sales.cost + repair.partsCost);

  return {
    totals: {
      lines: sales.lines + repair.lines + repair.works,
      units: sales.units + repair.units,
      partsRevenue,
      partsCost,
      partsMargin: round2(partsRevenue - partsCost),
      servicesRevenue: round2(repair.servicesRevenue),
      normHours: round2(repair.normHours),
      grossProfit: round2(partsRevenue - partsCost + repair.servicesRevenue),
    },
    facts: {
      shippedLines: sales.lines,
      closedOrders: repair.orders,
      works: repair.works,
      postedReceipts: Number(receipts.rows[0]!.n),
      stockMoves: Number(moves.rows[0]!.n),
      repairRevenue: round2(repair.partsRevenue + repair.servicesRevenue),
      journalByRole,
    },
  };
}

export type { Actual, ActualFacts };
