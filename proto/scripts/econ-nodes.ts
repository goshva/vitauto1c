import type { EconClient } from './econ-client.ts';
import type { EconRefs } from './econ-refs.ts';
import { ACTIONS, type ActResult } from './econ-actions.ts';
import type { LaborPlan, PartPlan } from '../src/domain/econ.ts';

// СООТВЕТСТВИЕ «УЗЕЛ КАРТЫ → ЧЕМ НАЖИМАЮТ».
//
// Порядок узлов задаёт карта процессов; здесь только адрес для каждого узла.
// Один узел может делать разное в разных процессах (K1 — приёмка, K5 — отгрузка),
// поэтому решение принимается по узлу И по объекту прогона.
//
// ГДЕ КАРТА И КОД РАСХОДИЛИСЬ, И ЧТО СТАЛО. У ремонта карта вела запчасти в «резерв»
// (M3), а задание забирает строки только из new / in_work / ready_to_ship
// (`src/operations.ts:17`) — «заказан» из резерва недостижим. Это было противоречие
// внутри модели: её сценарий шёл вразрез с её же таблицей переходов. 19.11.2026 шаг M3
// из сценария ремонта убран (`docs/fix-plan.md` §3.1), обход в прогоне снят.
//
// Метки M12/K5 в комментариях кода отгрузки были перепутаны — карта права:
// M12 «Отгрузочная ведомость» создаётся, K5 «Отгрузка клиенту» отгружает. Исправлено
// там же, в §3.2.

interface Obj {
  process: string;
  lineIds: string[];
  parts: PartPlan[];
  works: LaborPlan[];
  workOrderId: string | null;
  shipmentId: string | null;
}

interface NodeCtx {
  client: EconClient;
  refs: EconRefs;
  /** Куда складывать созданные документы — для проверок и отчёта. */
  result: { workOrderIds: string[]; shipmentIds: string[] };
}

/**
 * Что делает узел. `null` — у узла нет адреса в прототипе: контрольная точка,
 * внешняя сторона (клиент, поставщик) или состояние, которое уже поставил
 * предыдущий узел.
 */
export async function nodeAction(
  ctx: NodeCtx, o: Obj, nodes: string[], actor: string,
): Promise<ActResult | null> {
  const node = nodes[0] ?? '';
  const { refs } = ctx;

  switch (node) {
    case 'M2': {
      // Опознание позиции: менеджер выбирает ветвь сценария, и строка попадает в процесс.
      // Для ремонта этого не нужно: строки наряда получают процесс при создании
      // (`src/work-orders-flow.ts`, `src/work-orders-parts.ts`).
      if (!o.workOrderId) {
        for (const lineId of o.lineIds) {
          const assigned = await ACTIONS.assignProcess(ctx, lineId, o.process);
          if (assigned.status >= 400) return assigned;
        }
      }
      if (o.workOrderId) {
        for (const part of o.parts) {
          const nom = refs.nomenclature[part.article];
          if (!nom) continue;
          const r = await ACTIONS.woPart(ctx, o.workOrderId, nom.id, part.qty, part.costPrice,
            part.coefficient);
          if (r.lineId) o.lineIds.push(r.lineId);
        }
      }
      // Цены — по каждой позиции своей: закупка у запчастей разная.
      let last: ActResult | null = null;
      for (let k = 0; k < o.parts.length && k < o.lineIds.length; k++) {
        const part = o.parts[k]!;
        last = await ACTIONS.prices(ctx, [o.lineIds[k]!], part.costPrice, part.coefficient);
      }
      return last;
    }
    case 'M3':
      return ACTIONS.line(ctx, o.lineIds, actor, 'reserve');
    case 'M4':
      return ACTIONS.job(ctx, o.lineIds, actor);
    case 'M7':
      return ACTIONS.supply(ctx, o.lineIds, actor, 'paid');
    case 'P2':
      return ACTIONS.supply(ctx, o.lineIds, actor, 'in_transit');
    case 'K1':
      return ACTIONS.receipt(ctx, o.lineIds, actor);
    case 'K2':
      return ACTIONS.cell(ctx, o.lineIds);
    case 'M9':
      return ACTIONS.supply(ctx, o.lineIds, actor, 'assembly');
    case 'M11':
      return ACTIONS.supply(ctx, o.lineIds, actor, 'assembled');
    case 'M12': {
      const created = await ACTIONS.shipment(ctx, o.lineIds, actor);
      if (created.id) {
        o.shipmentId = created.id;
        ctx.result.shipmentIds.push(created.id);
      }
      return created;
    }
    case 'K5':
      return o.shipmentId ? ACTIONS.ship(ctx, o.shipmentId) : null;
    case 'M15': {
      // Отгруженную строку нельзя закрыть без отметки «документ подписан оригинал»
      // (C22, `src/domain/transition.ts:78-80`) — её ставит менеджер.
      await ACTIONS.signed(ctx, o.lineIds);
      const closed = await ACTIONS.line(ctx, o.lineIds, actor, 'closed');
      if (o.shipmentId) await ACTIONS.closeShipment(ctx, o.shipmentId);
      return closed;
    }
    case 'G1': {
      const car = refs.cars[ctx.result.workOrderIds.length % refs.cars.length]!;
      const created = await ACTIONS.woOpen(ctx, car, refs.customers[0] ?? '');
      if (created.id) {
        o.workOrderId = created.id;
        ctx.result.workOrderIds.push(created.id);
      }
      return created;
    }
    case 'G3': {
      if (!o.workOrderId) return null;
      let last: ActResult | null = null;
      for (const work of o.works) {
        last = await ACTIONS.woLabor(ctx, o.workOrderId, work.name, work.normHours, work.hourRate,
          refs.mechanic);
      }
      await ACTIONS.woTransition(ctx, o.workOrderId, 'in_work');
      return last;
    }
    case 'G9':
      return o.workOrderId ? ACTIONS.woTransition(ctx, o.workOrderId, 'closed') : null;
    default:
      return null;
  }
}

export type { Obj, NodeCtx };
