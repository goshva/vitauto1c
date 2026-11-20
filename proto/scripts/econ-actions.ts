import type { EconClient } from './econ-client.ts';
import { lineIdByClientNumber, type EconRefs } from './econ-refs.ts';

// ДЕЙСТВИЯ СОТРУДНИКОВ: тонкая обёртка над HTTP-адресами приложения.
//
// Здесь НЕТ логики процесса — только «чем именно нажимают». Порядок узлов задаёт
// карта процессов (`db/process-map.json`), а соответствие «узел → действие» —
// `scripts/econ-run.ts`. Разделение нужно потому, что один и тот же узел в разных
// процессах делается по-разному (K1 — приёмка, K5 — отгрузка), а один и тот же
// адрес обслуживает несколько узлов.

interface ActionCtx {
  client: EconClient;
  refs: EconRefs;
}

interface ActResult {
  endpoint: string;
  status: number;
  /** Идентификатор созданного документа, если действие его вернуло. */
  id: string | null;
  /** Идентификатор созданной строки (работа или запчасть в наряде). */
  lineId: string | null;
}

const idOf = (body: unknown): string | null => {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
};

const lineIdOf = (body: unknown): string | null => {
  if (body && typeof body === 'object' && 'lineId' in body) {
    const id = (body as { lineId: unknown }).lineId;
    return typeof id === 'string' ? id : null;
  }
  return null;
};

async function call(
  ctx: ActionCtx, role: string, method: string, path: string, body?: unknown,
): Promise<ActResult> {
  const r = await ctx.client.call(role, method, path, body);
  return {
    endpoint: `${method} ${path}`, status: r.status,
    id: idOf(r.body), lineId: lineIdOf(r.body),
  };
}

/** Заявка вставляется листом — тем же способом, что у оператора (ФТ v2 п. 8). */
async function paste(
  ctx: ActionCtx, article: string, qty: number, clientNumber: string, plate: string,
): Promise<{ result: ActResult; lineId: string | null }> {
  const nom = ctx.refs.nomenclature[article];
  const head = 'Наименование;Артикул;Кол-во;Ед.;Гос. номер;Срочно;База;№ заказа';
  const row = [nom?.name ?? article, article, String(qty), 'шт', plate, '', 'Склад на Ленина',
    clientNumber].join(';');
  const r = await ctx.client.form('manager', '/ui/lines/paste', {
    pasted: `${head}\n${row}`, customerId: ctx.refs.customers[0] ?? '',
  });
  return {
    result: { endpoint: 'POST /ui/lines/paste', status: r.status, id: null, lineId: null },
    lineId: await lineIdByClientNumber(clientNumber),
  };
}

/** Отметить строки: без отметки массовые действия не работают. */
async function mark(ctx: ActionCtx, ids: string[], role: string): Promise<void> {
  for (const id of ids) await ctx.client.call(role, 'POST', `/lines/${id}/mark`, { marked: true });
}

/** Цены: сначала закупка, потом множитель — сервер считает цену от закупки. */
async function prices(
  ctx: ActionCtx, ids: string[], cost: number, coefficient: number,
): Promise<ActResult> {
  let last: ActResult = { endpoint: '', status: 0, id: null, lineId: null };
  for (const id of ids) {
    await ctx.client.call('manager', 'PATCH', `/lines/${id}`, { field: 'cost_price', value: cost });
    last = await call(ctx, 'manager', 'PATCH', `/lines/${id}`, {
      field: 'coefficient', value: coefficient,
    });
  }
  return last;
}

async function cell(ctx: ActionCtx, ids: string[]): Promise<ActResult> {
  let last: ActResult = { endpoint: '', status: 0, id: null, lineId: null };
  for (const id of ids) {
    last = await call(ctx, 'storekeeper', 'PATCH', `/lines/${id}`, {
      field: 'cell_id', value: ctx.refs.cell,
    });
  }
  return last;
}

/** K1: приёмка создаётся по отмеченным строкам, затем проводится (движение склада). */
async function receipt(ctx: ActionCtx, ids: string[], role: string): Promise<ActResult> {
  await mark(ctx, ids, role);
  const created = await call(ctx, role, 'POST', '/receipts', {});
  if (!created.id) return created;
  const posted = await call(ctx, role, 'POST', `/receipts/${created.id}/post`, {});
  return { ...posted, endpoint: `${created.endpoint} + ${posted.endpoint}`, id: created.id };
}
async function shipment(ctx: ActionCtx, ids: string[], role: string): Promise<ActResult> {
  await mark(ctx, ids, role);
  return call(ctx, role, 'POST', '/shipments', {});
}

async function job(ctx: ActionCtx, ids: string[], role: string): Promise<ActResult> {
  await mark(ctx, ids, role);
  return call(ctx, role, 'POST', '/sales/jobs', { allowSplit: false });
}

async function supply(ctx: ActionCtx, ids: string[], role: string, status: string): Promise<ActResult> {
  await mark(ctx, ids, role);
  return call(ctx, role, 'POST', '/supply/status', { status });
}

async function line(ctx: ActionCtx, ids: string[], role: string, to: string): Promise<ActResult> {
  await mark(ctx, ids, role);
  return call(ctx, role, 'POST', '/lines/transition', { to });
}

/** Закрытие отгруженной строки требует отметки «документ подписан оригинал» (C22). */
async function signed(ctx: ActionCtx, ids: string[]): Promise<void> {
  for (const id of ids) {
    await ctx.client.call('manager', 'PATCH', `/lines/${id}`, {
      field: 'signed_original', value: true,
    });
  }
}

export const ACTIONS = {
  paste, mark, prices, cell, receipt, shipment, job, supply, line, signed,
  /** Назначение процесса строке: без него `/lines/step` для неё недоступен. */
  assignProcess: (ctx: ActionCtx, lineId: string, processId: string): Promise<ActResult> =>
    call(ctx, 'manager', 'POST', `/lines/${lineId}/process`, { processId }),
  ship: (ctx: ActionCtx, id: string): Promise<ActResult> =>
    call(ctx, 'storekeeper', 'POST', `/shipments/${id}/ship`, {}),
  closeShipment: (ctx: ActionCtx, id: string): Promise<ActResult> =>
    call(ctx, 'manager', 'POST', `/shipments/${id}/close`, {}),
  woOpen: (ctx: ActionCtx, carId: string, counterpartyId: string): Promise<ActResult> =>
    call(ctx, 'manager', 'POST', '/work-orders', {
      carId, counterpartyId, serviceTypeId: ctx.refs.serviceType, comment: 'ЭКОН: месяц',
    }),
  woPart: (ctx: ActionCtx, woId: string, nomenclatureId: string, quantity: number, cost: number,
    coefficient: number): Promise<{ result: ActResult; lineId: string | null }> =>
    call(ctx, 'manager', 'POST', `/work-orders/${woId}/part`, {
      nomenclatureId, quantity: String(quantity), costPrice: String(cost),
      salePrice: String(Math.round(cost * coefficient * 100) / 100),
    }).then((r) => ({ result: r, lineId: r.lineId })),
  woLabor: (ctx: ActionCtx, woId: string, name: string, normHours: number, rate: number,
    executorId: string): Promise<ActResult> =>
    call(ctx, 'mechanic', 'POST', `/work-orders/${woId}/labor`, {
      name, normHours: String(normHours), salePrice: String(rate), executorId,
    }),
  woTransition: (ctx: ActionCtx, woId: string, to: string): Promise<ActResult> =>
    call(ctx, 'mechanic', 'POST', `/work-orders/${woId}/transition`, { to }),
};

export type { ActionCtx, ActResult };
