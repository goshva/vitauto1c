import { describe, expect, test, beforeAll } from 'bun:test';
import { pool } from '../../src/db.ts';
import { request } from '../helpers/request.ts';
import { processById } from '../../src/domain/process-map.ts';
import {
  ECON_RULES, payroll, round2, summarize, type MonthParams,
} from '../../src/domain/econ.ts';
import { planMonth } from '../../src/domain/econ-plan.ts';
import { attributeByRole } from '../../src/domain/econ-roles.ts';
import { prepareMonth } from '../../db/seed-econ.ts';
import { runMonth } from '../../scripts/econ-run.ts';
import { loadActual } from '../../scripts/econ-actual.ts';

// ЭКОНОМИКА МЕСЯЦА: проверки по частям.
//
// Здесь три независимых вопроса, и их нельзя смешивать:
//   1. Арифметика модели — считается ли она так, как записано в условии.
//   2. Сверка плана и факта — получается ли тот же месяц действиями сотрудников.
//   3. Оплата — покрывает ли прибыль оклады и долю исполнителя.
//
// Месяц для проверок СЖАТЫЙ (5 объектов): полный месяц — это тысячи запросов, и
// держать его в обычном прогоне тестов незачем. Полный считается командой
// `bun run scripts/econ-month.ts`.

const SMALL: MonthParams = {
  happyLines: 2, stockLines: 1, workOrders: 1, laborPerOrder: 1, partsPerOrder: 1, seed: 7,
};

describe('модель месяца: арифметика условия', () => {
  test('цена продажи = закупка × множитель, округление до копеек', () => {
    const plan = planMonth(SMALL);
    for (const part of plan.parts) {
      expect(part.salePrice).toBe(round2(part.costPrice * part.coefficient));
    }
  });

  test('прибыль = выручка − себестоимость, услуги считаются по нормо-часам', () => {
    const plan = planMonth(SMALL);
    const t = summarize(plan);

    let revenue = 0;
    let cost = 0;
    for (const p of plan.parts) {
      revenue += p.qty * p.salePrice;
      cost += p.qty * p.costPrice;
    }
    let services = 0;
    for (const w of plan.works) services += round2(w.normHours * w.hourRate);

    expect(t.partsRevenue).toBe(round2(revenue));
    expect(t.partsCost).toBe(round2(cost));
    expect(t.partsMargin).toBe(round2(revenue - cost));
    expect(t.servicesRevenue).toBe(round2(services));
    expect(t.grossProfit).toBe(round2(revenue - cost + services));
  });

  test('фонд оплаты: пять окладов плюс 25% от услуг', () => {
    const t = summarize(planMonth(SMALL));
    const fund = payroll(t);

    expect(fund.salaryBase).toBe(ECON_RULES.salaryPerRole * ECON_RULES.paidRoles.length);
    expect(fund.piece).toBe(round2(t.servicesRevenue * ECON_RULES.pieceShare));
    expect(fund.total).toBe(round2(fund.salaryBase + fund.piece));
    expect(fund.net).toBe(round2(t.grossProfit - fund.total));
  });

  test('вклад ролей выводится из узлов процесса, а не задаётся вручную', () => {
    const plan = planMonth(SMALL);
    const steps: Record<string, string[][]> = {};
    for (const id of ['happy', 'stock', 'car_repair_in']) {
      steps[id] = (processById(id)?.steps ?? []).map((s) => s.roles.map(
        (r) => (r === 'chief_mechanic' ? 'mechanic' : r),
      ));
    }
    const byRole = attributeByRole(plan, steps);
    const sum = round2(byRole.reduce((acc, r) => acc + r.marginShare + r.servicesShare, 0));
    const expected = round2(summarize(plan).partsMargin + summarize(plan).servicesRevenue);

    // Прибыль и услуги распределены ЦЕЛИКОМ: ни рубля не потеряно и не выдумано.
    expect(sum).toBe(expected);
    expect(byRole.some((r) => r.role === 'manager' && r.actions > 0)).toBe(true);
    expect(byRole.some((r) => r.role === 'mechanic' && r.actions > 0)).toBe(true);
    expect(byRole.some((r) => r.role === 'storekeeper' && r.actions > 0)).toBe(true);
  });
});

describe('месяц действиями сотрудников', () => {
  let planned: ReturnType<typeof summarize>;
  let actual: Awaited<ReturnType<typeof loadActual>>;
  let run: Awaited<ReturnType<typeof runMonth>>;

  beforeAll(async () => {
    const plan = await prepareMonth(SMALL);
    planned = summarize(plan);
    const startedAt = new Date();
    run = await runMonth(plan);
    actual = await loadActual(startedAt);
  });

  test('все узлы пройдены без отказов', () => {
    expect(run.actions.length).toBeGreaterThan(0);
    expect(run.failures).toEqual([]);
  });

  test('факт совпадает с предварительным расчётом до копейки', () => {
    expect(actual.totals.partsRevenue).toBeCloseTo(planned.partsRevenue, 2);
    expect(actual.totals.partsCost).toBeCloseTo(planned.partsCost, 2);
    expect(actual.totals.partsMargin).toBeCloseTo(planned.partsMargin, 2);
    expect(actual.totals.servicesRevenue).toBeCloseTo(planned.servicesRevenue, 2);
    expect(actual.totals.normHours).toBeCloseTo(planned.normHours, 2);
    expect(actual.totals.grossProfit).toBeCloseTo(planned.grossProfit, 2);
  });

  test('документы действительно созданы: приёмки проведены, отгрузки отгружены', async () => {
    expect(actual.facts.postedReceipts).toBeGreaterThan(0);
    expect(actual.facts.stockMoves).toBeGreaterThan(0);
    expect(actual.facts.closedOrders).toBeGreaterThan(0);

    const shipped = await pool.query<{ n: string }>(
      `select count(*)::text as n from line_view
        where "shipmentDate" is not null and status = 'closed'`,
    );
    expect(Number(shipped.rows[0]!.n)).toBe(actual.facts.shippedLines);
  });

  test('действия журнала подтверждают работу ролей независимо от прогона', () => {
    // Журнал пишут не все адреса (отметки, канбан, работы в наряде — нет), поэтому
    // проверяется не равенство, а то, что записи есть у тех ролей, что действовали.
    const journal = actual.facts.journalByRole;
    expect(journal.manager ?? 0).toBeGreaterThan(0);
    expect(journal.storekeeper ?? 0).toBeGreaterThan(0);
  });

  test('все строки месяца стоят в процессе — по ним можно идти по узлам', async () => {
    // До правки `docs/fix-plan.md` §4 строки, созданные через приложение, в процессе
    // не числились, и `/lines/step` отвечал им `outside_process`.
    const r = await pool.query<{ n: string }>(
      `select count(*)::text as n from line where not deleted and process_id is null`,
    );
    expect(Number(r.rows[0]!.n), 'есть строки вне процесса').toBe(0);

    const steps = await pool.query<{ n: string }>(
      `select count(*)::text as n from line where not deleted and process_step = 1`,
    );
    expect(Number(steps.rows[0]!.n), 'ни одна строка не стоит на первом шаге').toBeGreaterThan(0);
  });

  test('два отчёта вместе дают выручку месяца: продажи + ремонт', async () => {
    // Решение заказчика 20.11.2026: ремонт — ОТДЕЛЬНЫЙ отчёт. Проверка в том, что
    // вместе они дают полную выручку месяца, а по отдельности не теряют и не двоят.
    const sales = await request('/reports/profitability', {
      headers: { accept: 'application/json' },
    });
    const repair = await request('/reports/repair', {
      headers: { accept: 'application/json' },
    });
    expect(sales.status).toBe(200);
    expect(repair.status).toBe(200);

    const s = await sales.json() as { totals: { revenue: number; cost: number } };
    const rp = await repair.json() as { totals: { revenue: number; cost: number } };

    const expectedRevenue = round2(actual.totals.partsRevenue + actual.totals.servicesRevenue);
    expect(round2(s.totals.revenue + rp.totals.revenue), 'два отчёта не дают выручку месяца')
      .toBeCloseTo(expectedRevenue, 2);
    expect(round2(s.totals.cost + rp.totals.cost), 'себестоимость в двух отчётах')
      .toBeCloseTo(actual.totals.partsCost, 2);

    expect(rp.totals.revenue, 'в месяце не было ремонта').toBeGreaterThan(0);
    expect(actual.facts.repairRevenue, 'выручка ремонта не посчитана').toBeGreaterThan(0);
  });
});

describe('обоснование оплаты', () => {
  test('при сжатом месяце фонд не покрыт — и это видно числом', () => {
    const t = summarize(planMonth(SMALL));
    const fund = payroll(t);
    expect(fund.coveragePct).toBeLessThan(100);
    expect(fund.net).toBeLessThan(0);
  });

  test('окупаемость считается от вклада одного заказа', () => {
    const plan = planMonth(SMALL);
    const t = summarize(plan);
    const fund = payroll(t).total;
    const objects = plan.parts.filter((p) => p.process !== 'car_repair_in').length
      + plan.params.workOrders;
    const perObject = (t.partsMargin + t.servicesRevenue) / objects;
    const needed = Math.ceil(fund / perObject);

    // Проверка условия: нужное число заказов действительно покрывает фонд, а на один
    // меньше — уже нет. Иначе «нужно N» было бы числом без смысла.
    expect(perObject * needed).toBeGreaterThanOrEqual(fund);
    expect(perObject * (needed - 1)).toBeLessThan(fund);
  });
});
