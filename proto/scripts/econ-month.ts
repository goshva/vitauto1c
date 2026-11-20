import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool } from '../src/db.ts';
import { processById } from '../src/domain/process-map.ts';
import {
  ECON_RULES, payroll, round2, summarize,
  type EconTotals, type MonthParams, type MonthPlan,
} from '../src/domain/econ.ts';
import { attributeByRole } from '../src/domain/econ-roles.ts';
import { prepareMonth } from '../db/seed-econ.ts';
import { runMonth } from './econ-run.ts';
import { loadActual } from './econ-actual.ts';

// МЕСЯЦ ЦЕЛИКОМ: сид → предварительный расчёт → действия сотрудников → факт → сверка.
//
// ЗАЧЕМ ДВА РАСЧЁТА. Первый считается из входных значений и не знает про базу. Второй
// берётся из базы после того, как роли прошли процессы. Совпали — значит и модель, и
// действия описывают один и тот же месяц; разошлись — ошибка в одном из двух, и это
// видно до того, как по числам начнут платить зарплату.
//
// Запуск:
//   bun run scripts/econ-month.ts              — полный месяц (по умолчанию)
//   bun run scripts/econ-month.ts small        — сжатый месяц (для проверок)
//   bun run scripts/econ-month.ts --seed 7     — другой синтетический набор

const FULL: MonthParams = {
  happyLines: 60, stockLines: 40, workOrders: 50, laborPerOrder: 2, partsPerOrder: 1, seed: 20261118,
};
const SMALL: MonthParams = {
  happyLines: 3, stockLines: 2, workOrders: 2, laborPerOrder: 2, partsPerOrder: 1, seed: 42,
};

const args = process.argv.slice(2);
const seedArg = args.indexOf('--seed');
const params: MonthParams = args.includes('small') ? { ...SMALL } : { ...FULL };
if (seedArg !== -1 && args[seedArg + 1]) params.seed = Number(args[seedArg + 1]);

const money = (n: number): string =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const row = (name: string, plan: number, fact: number | null, tol = 0.05): string => {
  const delta = fact === null ? '' : money(fact - plan);
  const mark = fact === null ? '—' : (Math.abs(fact - plan) <= tol ? 'сходится' : `РАСХОЖДЕНИЕ ${delta}`);
  return `  ${name.padEnd(28)} план ${money(plan).padStart(14)}   факт ${
    fact === null ? '—'.padStart(14) : money(fact).padStart(14)}   ${mark}`;
};

/**
 * Роли узлов по карте процессов — основа отнесения прибыли на роли.
 *
 * `chief_mechanic` карты приводится к `mechanic` системы: роль одна, а названия
 * разные (`src/domain/roles.ts` знает пять ролей, карта — шесть, включая внешних
 * `client` и `supplier`). Без приведения механик получил бы две доли, и ни одна
 * из них не покрыла бы оклад.
 */
function roleSteps(): Record<string, string[][]> {
  const out: Record<string, string[][]> = {};
  for (const id of ['happy', 'stock', 'car_repair_in']) {
    out[id] = (processById(id)?.steps ?? []).map((s) => s.roles.map(
      (r) => (r === 'chief_mechanic' ? 'mechanic' : r),
    ));
  }
  return out;
}

/** Сколько заказов нужно, чтобы фонд оплаты окупился при текущей структуре. */
function breakEven(t: EconTotals, plan: MonthPlan): { objects: number; needed: number; perObject: number } {
  const saleLines = plan.parts.filter((p) => p.process !== 'car_repair_in').length;
  const objects = saleLines + plan.params.workOrders;
  const perObject = objects === 0 ? 0 : (t.partsMargin + t.servicesRevenue) / objects;
  const fund = payroll(t).total;
  return { objects, needed: perObject === 0 ? Infinity : Math.ceil(fund / perObject), perObject };
}

async function main(): Promise<void> {
  console.log(`=== МЕСЯЦ: сид (${JSON.stringify(params)}) ===`);
  const plan = await prepareMonth(params);
  const planned = summarize(plan);
  const planPayroll = payroll(planned);
  console.log(`  строк: ${plan.parts.length + plan.works.length} `
    + `(запчасти ${plan.parts.length}, работы ${plan.works.length}), `
    + `заказ-нарядов ${plan.params.workOrders}`);

  console.log('=== ДЕЙСТВИЯ СОТРУДНИКОВ ПО УЗЛАМ ===');
  const startedAt = new Date();
  const run = await runMonth(plan);
  const called = run.actions.filter((a) => a.called).length;
  console.log(`  узлов пройдено: ${run.actions.length}, из них с адресом: ${called}, `
    + `HTTP-запросов: ${run.requests}, отказов: ${run.failures.length}`);
  for (const f of run.failures.slice(0, 10)) {
    console.log(`  ОТКАЗ ${f.process} шаг ${f.step} ${f.node} ${f.actor}: ${f.endpoint} → ${f.status}`);
  }

  console.log('=== ФАКТ ИЗ БАЗЫ ===');
  const actual = await loadActual(startedAt);
  const factPayroll = payroll(actual.totals);
  console.log(row('Выручка запчастей', planned.partsRevenue, actual.totals.partsRevenue));
  console.log(row('Себестоимость', planned.partsCost, actual.totals.partsCost));
  console.log(row('Прибыль запчастей', planned.partsMargin, actual.totals.partsMargin));
  console.log(row('Выручка услуг', planned.servicesRevenue, actual.totals.servicesRevenue));
  console.log(row('Нормо-часы', planned.normHours, actual.totals.normHours));
  console.log(row('Прибыль до фонда', planned.grossProfit, actual.totals.grossProfit));
  console.log(row('Фонд оплаты', planPayroll.total, factPayroll.total));
  console.log(row('Чистый результат', planPayroll.net, factPayroll.net));

  const byRole = attributeByRole(plan, roleSteps());
  const actors = new Map<string, { actions: number; called: number }>();
  for (const a of run.actions) {
    const row = actors.get(a.actor) ?? { actions: 0, called: 0 };
    row.actions += 1;
    if (a.called) row.called += 1;
    actors.set(a.actor, row);
  }

  console.log('=== ДЕЙСТВИЯ И ВКЛАД ПО РОЛЯМ ===');
  // ВКЛАД И ВЫПЛАТА — РАЗНЫЕ ВЕЛИЧИНЫ, и их нельзя сравнивать одной колонкой.
  // Вклад — прибыль, отнесённая на роль по участию в узлах. Выплата — оклад плюс
  // доля исполнителя. Доля считается от выручки за услуги, а не от вклада, поэтому
  // у механика выплата растёт вместе с услугами, даже если узлов у него немного.
  console.log('  роль          узлов  запросов  журнал       вклад      выплата  покрытие');
  const salaryOf = (role: string): number =>
    (ECON_RULES.paidRoles as readonly string[]).includes(role) ? ECON_RULES.salaryPerRole : 0;

  for (const share of byRole) {
    const act = actors.get(share.role) ?? { actions: 0, called: 0 };
    const journal = actual.facts.journalByRole[share.role] ?? 0;
    const contribution = round2(share.marginShare + share.servicesShare);
    const payout = round2(salaryOf(share.role) + share.piece);
    const cover = payout === 0 ? '—' : `${Math.round((contribution / payout) * 100)}%`;
    console.log(`  ${share.role.padEnd(13)} ${String(act.actions).padStart(5)} ${
      String(act.called).padStart(9)} ${String(journal).padStart(7)} ${
      money(contribution).padStart(12)} ${money(payout).padStart(12)} ${cover.padStart(8)}`);
  }

  const servicePool = round2(actual.totals.servicesRevenue - factPayroll.piece);
  console.log(`  услуги: ${money(actual.totals.servicesRevenue)} − доля исполнителя `
    + `${money(factPayroll.piece)} = ${money(servicePool)} остаётся в общем котле`);

  const be = breakEven(planned, plan);
  const salaryFund = ECON_RULES.salaryPerRole * ECON_RULES.paidRoles.length;
  console.log('=== ОБОСНОВАНИЕ ОПЛАТЫ ===');
  console.log(`  оклады: ${ECON_RULES.paidRoles.length} роли × ${money(ECON_RULES.salaryPerRole)} = ${money(salaryFund)}`);
  console.log(`  доля исполнителя: ${ECON_RULES.pieceShare * 100}% от услуг = ${money(factPayroll.piece)}`);
  console.log(`  фонд: ${money(factPayroll.total)}; прибыль: ${money(actual.totals.grossProfit)}; `
    + `покрытие ${factPayroll.coveragePct}%`);
  console.log(`  заказов в месяце: ${be.objects}; вклад одного: ${money(be.perObject)}; `
    + `для окупаемости нужно: ${be.needed}`);

  const report = {
    generatedAt: new Date().toISOString(),
    params, planned, actual: actual.totals, facts: actual.facts,
    plannedPayroll: planPayroll, actualPayroll: factPayroll,
    actions: { total: run.actions.length, called, requests: run.requests, failures: run.failures.length },
    actors: Object.fromEntries(actors),
    byRole, breakEven: be,
  };
  const out = resolve(import.meta.dir, '../logs/econ-month.json');
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`отчёт: ${out}`);
  await pool.end();
}

await main();
