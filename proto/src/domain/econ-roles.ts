import { ECON_RULES, round2, summarize, type MonthPlan, type RoleShare } from './econ.ts';

// ОТНЕСЕНИЕ ПРИБЫЛИ НА РОЛИ ПО УЧАСТИЮ В УЗЛАХ ПРОЦЕССА.
//
// Каждый шаг процесса даёт роль (или несколько) — так записано в `db/process-map.json`.
// Прибыль строки делится поровну между шагами её процесса, а внутри шага — между
// ролями шага. Это не «экспертная» развесовка: она целиком выводится из карты
// процессов, и её можно пересчитать, не читая этот файл.
//
// ЧЕГО ЭТОТ СПОСОБ НЕ УМЕЕТ, и об этом надо сказать прямо: карта МЕНЕДЖЕРСКАЯ —
// 66 шагов из 121 принадлежат менеджеру. Поэтому по узлам менеджер получает больше
// всех, и «вклад» здесь — мера участия в процессе, а не оценка полезности роли.
// Для механика рядом стоит ДРУГАЯ величина — доля исполнителя от услуг: она считается
// от денег, а не от числа шагов.

const PROCESS_IDS = ['happy', 'stock', 'car_repair_in'] as const;

export function attributeByRole(
  plan: MonthPlan,
  roleSteps: Record<string, string[][]>,
): RoleShare[] {
  const shares = new Map<string, RoleShare>();
  const share = (role: string): RoleShare => {
    const found = shares.get(role);
    if (found) return found;
    const created: RoleShare = {
      role, actions: 0, marginShare: 0, servicesShare: 0, piece: 0, total: 0,
    };
    shares.set(role, created);
    return created;
  };

  const marginOf = (process: string): number => {
    let sum = 0;
    for (const part of plan.parts) {
      if (part.process === process) sum += part.qty * (part.salePrice - part.costPrice);
    }
    return round2(sum);
  };

  // Сколько объектов идёт по процессу: строка для продажи, заказ-наряд для ремонта.
  // Действие считается на объект: «менеджер провёл M4» — по одному разу на строку.
  const objects: Record<string, number> = {
    happy: plan.parts.filter((x) => x.process === 'happy').length,
    stock: plan.parts.filter((x) => x.process === 'stock').length,
    car_repair_in: plan.params.workOrders,
  };

  const services = round2(plan.works.reduce((acc, w) => acc + w.amount, 0));

  for (const process of PROCESS_IDS) {
    const steps = roleSteps[process];
    if (!steps || steps.length === 0) continue;
    const count = objects[process] ?? 0;
    const marginPerStep = marginOf(process) / steps.length;
    const servicesPerStep = process === 'car_repair_in' ? services / steps.length : 0;

    for (const roles of steps) {
      if (roles.length === 0) continue;
      for (const role of roles) {
        const row = share(role);
        row.actions += count;
        // Без промежуточного округления: округление на каждом шаге дало бы дрейф в
        // копейки, и сумма долей перестала бы сходиться с прибылью.
        row.marginShare += marginPerStep / roles.length;
        row.servicesShare += servicesPerStep / roles.length;
      }
    }
  }

  // Доля исполнителя — сверх участия в узлах: её получает тот, кто выполнил работу.
  const mechanic = share('mechanic');
  mechanic.piece = round2(summarize(plan).servicesRevenue * ECON_RULES.pieceShare);

  const rows = [...shares.values()].map((r) => ({
    ...r,
    marginShare: round2(r.marginShare),
    servicesShare: round2(r.servicesShare),
  }));

  // ОКРУГЛЕНИЕ НЕ ДОЛЖНО ТЕРЯТЬ КОПЕЙКУ. Каждая доля округляется отдельно, поэтому их
  // сумма может разойтись с прибылью на копейки. Остаток отдаём самой крупной роли: тогда
  // сумма долей РАВНА прибыли и услугам, и это проверяется тестом без допуска.
  const distributed = round2(rows.reduce((acc, r) => acc + r.marginShare + r.servicesShare, 0));
  const drift = round2(summarize(plan).partsMargin + services - distributed);
  if (drift !== 0 && rows.length > 0) {
    const biggest = rows.reduce((a, b) =>
      (b.marginShare + b.servicesShare > a.marginShare + a.servicesShare ? b : a));
    biggest.marginShare = round2(biggest.marginShare + drift);
  }

  return rows
    .map((r) => ({ ...r, total: round2(r.marginShare + r.servicesShare + r.piece) }))
    .sort((a, b) => b.total - a.total);
}
