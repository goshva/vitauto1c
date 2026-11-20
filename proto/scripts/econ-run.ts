import { processById } from '../src/domain/process-map.ts';
import { createClient } from './econ-client.ts';
import { loadRefs } from './econ-refs.ts';
import { ACTIONS } from './econ-actions.ts';
import { nodeAction, type Obj } from './econ-nodes.ts';
import type { MonthPlan, PartPlan } from '../src/domain/econ.ts';

// ПРОГОН МЕСЯЦА ПО УЗЛАМ ПРОЦЕССА.
//
// Порядок узлов берётся ИЗ КАРТЫ ПРОЦЕССОВ (`db/process-map.json`), а не из этого
// файла: здесь только обход. Поэтому прогон нельзя «упростить», не заметив: если
// карта изменится, изменится и порядок действий, а не только подпись на экране.
//
// РОЛЬ ДЕЙСТВУЮЩЕГО И РОЛЬ УЗЛА — РАЗНЫЕ ВЕЩИ. В карте узел N1 принадлежит клиенту,
// а P1 — поставщику; учётных записей у них нет. Действие выполняет система от имени
// сотрудника (менеджер вносит заявку клиента), и в журнале прогона видно ОБА:
// `mapRole` — из карты, `actor` — кто нажал. Считать зарплату по `mapRole` значило бы
// платить поставщику.

/** Кто нажимает, когда узел принадлежит внешней стороне. */
const ACTOR: Record<string, string> = {
  manager: 'manager',
  storekeeper: 'storekeeper',
  chief_mechanic: 'mechanic',
  admin: 'admin',
  client: 'manager',
  supplier: 'manager',
};

interface ActionLog {
  process: string;
  step: number;
  node: string;
  /** Роль узла по карте процессов. */
  mapRole: string;
  /** Кто фактически выполнил действие. */
  actor: string;
  endpoint: string;
  status: number;
  called: boolean;
}

interface RunResult {
  actions: ActionLog[];
  failures: ActionLog[];
  lineIds: string[];
  shipmentIds: string[];
  workOrderIds: string[];
  /** Сколько HTTP-запросов ушло: узлов меньше, чем запросов. */
  requests: number;
}

interface RunCtx {
  client: ReturnType<typeof createClient>;
  refs: Awaited<ReturnType<typeof loadRefs>>;
  result: RunResult;
}

const ok = (status: number): boolean => status >= 200 && status < 300;

/** Пройти процесс по узлам: один шаг карты — одно действие роли. */
async function walk(ctx: RunCtx, o: Obj): Promise<void> {
  const process = processById(o.process);
  if (!process) throw new Error(`процесс «${o.process}» не найден в карте`);

  for (const step of process.steps) {
    const mapRole = step.roles[0] ?? 'manager';
    const actor = ACTOR[mapRole] ?? 'manager';
    const action = await nodeAction(ctx, o, step.nodes, actor);

    const log: ActionLog = {
      process: o.process,
      step: step.n,
      node: step.nodes.join(','),
      mapRole,
      actor,
      endpoint: action?.endpoint ?? '(без адреса)',
      status: action?.status ?? 0,
      called: action !== null,
    };
    ctx.result.actions.push(log);
    if (action && !ok(action.status)) ctx.result.failures.push(log);
  }
}

const isSale = (part: PartPlan): boolean => part.process !== 'car_repair_in';

export async function runMonth(plan: MonthPlan): Promise<RunResult> {
  const refs = await loadRefs();
  const ctx: RunCtx = {
    client: createClient(),
    refs,
    result: { actions: [], failures: [], lineIds: [], shipmentIds: [], workOrderIds: [], requests: 0 },
  };

  // Продажа: каждая строка — своя заявка (N1), затем узлы её процесса.
  let n = 0;
  for (const part of plan.parts.filter(isSale)) {
    n++;
    const marker = `ЭКОН-${part.process}-${n}`;
    const { result, lineId } = await ACTIONS.paste(ctx, part.article, part.qty, marker, 'А123ВС77');
    ctx.result.actions.push({
      process: part.process, step: 1, node: 'N1', mapRole: 'client', actor: 'manager',
      endpoint: result.endpoint, status: result.status, called: true,
    });
    if (!ok(result.status)) ctx.result.failures.push(ctx.result.actions.at(-1)!);
    if (!lineId) continue;
    ctx.result.lineIds.push(lineId);
    await walk(ctx, {
      process: part.process, lineIds: [lineId], parts: [part], works: [],
      workOrderId: null, shipmentId: null,
    });
  }

  // Ремонт: заказ-наряд ведёт менеджер, работы выполняет механик (G3, G9).
  for (let i = 1; i <= plan.params.workOrders; i++) {
    const key = `repair-${i}`;
    await walk(ctx, {
      process: 'car_repair_in',
      lineIds: [],
      parts: plan.parts.filter((p) => p.orderKey === key),
      works: plan.works.filter((w) => w.orderKey === key),
      workOrderId: null,
      shipmentId: null,
    });
  }

  ctx.result.shipmentIds = [...new Set(ctx.result.shipmentIds)];
  ctx.result.requests = ctx.client.stats.calls;
  return ctx.result;
}
