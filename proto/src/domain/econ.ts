// ЭКОНОМИКА МЕСЯЦА: условия оплаты и итоги, без обращений к базе.
//
// ЗАЧЕМ ОТДЕЛЬНО ОТ ПРОГОНА. Месяц считается ДВАЖДЫ и разными способами:
//   • предварительно — из входных значений (цены, множители, нормо-часы), здесь;
//   • по факту — из `line_view` и заказ-нарядов после того, как сотрудники прошли
//     процессы (`scripts/econ-actual.ts`).
// Совпадение двух чисел и есть проверка: расчёт, сверенный сам с собой тем же
// запросом, не проверяет ничего (тот же довод, что в `src/domain/reports.ts:3-6`).
//
// ЦЕНА ПРОДАЖИ СЧИТАЕТСЯ КАК НА СЕРВЕРЕ: закупка × множитель, округление до копеек
// (`src/lines-fields.ts:131-143`). Иначе «план» и «факт» разошлись бы на копейку,
// и сверка перестала бы быть проверкой.

/** Оклад одной роли в месяц, ₽ (условие задания). */
const SALARY_PER_ROLE = 100_000;

/** Доля исполнителя от выручки за услуги (условие задания). */
const PIECE_SHARE = 0.25;

/** Роли, которые получают оклад. Ровно те пять, что объявлены в `src/domain/roles.ts`. */
const PAID_ROLES = ['admin', 'municipality', 'manager', 'mechanic', 'storekeeper'] as const;

/** Условия оплаты одним объектом: их читают и расчёт, и отчёт, и тесты. */
export const ECON_RULES = {
  salaryPerRole: SALARY_PER_ROLE,
  pieceShare: PIECE_SHARE,
  paidRoles: PAID_ROLES,
  /** Рабочих дней в месяце — для «сколько заказов в день». */
  workDays: 22,
} as const;

interface PartPlan {
  key: string;
  process: string;
  /** Заказ-наряд, к которому относится запчасть. У продажи — пусто. */
  orderKey: string | null;
  article: string;
  qty: number;
  /** Закупочная цена единицы — вход модели. */
  costPrice: number;
  /** Множитель менеджера: цена продажи = закупка × множитель. */
  coefficient: number;
  /** Цена продажи единицы, округлённая как на сервере. */
  salePrice: number;
}

interface LaborPlan {
  key: string;
  orderKey: string;
  name: string;
  normHours: number;
  /** Цена нормо-часа, ₽. */
  hourRate: number;
  amount: number;
}

interface MonthParams {
  happyLines: number;
  stockLines: number;
  workOrders: number;
  laborPerOrder: number;
  partsPerOrder: number;
  seed: number;
}

interface MonthPlan {
  params: MonthParams;
  parts: PartPlan[];
  works: LaborPlan[];
  /** Сколько строк в каком процессе — для разреза по процессам. */
  byProcess: Record<string, number>;
}

interface EconTotals {
  lines: number;
  units: number;
  partsRevenue: number;
  partsCost: number;
  partsMargin: number;
  servicesRevenue: number;
  normHours: number;
  /** Выручка минус материалы. Услуги материала не расходуют. */
  grossProfit: number;
}

interface Payroll {
  salaryBase: number;
  piece: number;
  total: number;
  /** Прибыль минус фонд оплаты. */
  net: number;
  /** Сколько процентов фонда покрывает прибыль. */
  coveragePct: number;
}

interface RoleShare {
  role: string;
  actions: number;
  /** Прибыль от запчастей, отнесённая на роль по участию в узлах процесса. */
  marginShare: number;
  /** Выручка за услуги, отнесённая так же. */
  servicesShare: number;
  /** Доля исполнителя от услуг (только у механика). */
  piece: number;
  total: number;
}

export type { PartPlan, LaborPlan, MonthParams, MonthPlan, EconTotals, Payroll, RoleShare };

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Итоги плана: выручка, материалы, прибыль до фонда оплаты. */
export function summarize(plan: MonthPlan): EconTotals {
  let partsRevenue = 0;
  let partsCost = 0;
  let units = 0;

  for (const part of plan.parts) {
    units += part.qty;
    partsRevenue += part.qty * part.salePrice;
    partsCost += part.qty * part.costPrice;
  }

  let servicesRevenue = 0;
  let normHours = 0;
  for (const work of plan.works) {
    servicesRevenue += work.amount;
    normHours += work.normHours;
  }

  return {
    lines: plan.parts.length + plan.works.length,
    units,
    partsRevenue: round2(partsRevenue),
    partsCost: round2(partsCost),
    partsMargin: round2(partsRevenue - partsCost),
    servicesRevenue: round2(servicesRevenue),
    normHours: round2(normHours),
    grossProfit: round2(partsRevenue - partsCost + servicesRevenue),
  };
}

/** Фонд оплаты: оклады пяти ролей плюс доля исполнителя от услуг. */
export function payroll(t: EconTotals, roles: number = PAID_ROLES.length): Payroll {
  const salaryBase = round2(SALARY_PER_ROLE * roles);
  const piece = round2(t.servicesRevenue * PIECE_SHARE);
  const total = round2(salaryBase + piece);
  const net = round2(t.grossProfit - total);
  return {
    salaryBase,
    piece,
    total,
    net,
    coveragePct: total === 0 ? 0 : Math.round((t.grossProfit / total) * 1000) / 10,
  };
}
