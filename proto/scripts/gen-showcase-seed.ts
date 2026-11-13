import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Витрина: по строке на КАЖДЫЙ этап КАЖДОГО процесса + необходимые документы.
//
// Зачем: обычные сиды дают один-два процесса, и карта процессов «живая» лишь
// частично. Строк столько, сколько пар «процесс × состояние»: соседние шаги
// одного процесса часто в одном состоянии, и вторая строка ничего не добавит.
//
// Запуск ОТДЕЛЬНО (`bun run db:seed --showcase`), не вместе с `--all`:
// 61 строка и десятки документов сделали бы состояние e2e непредсказуемым.

const MAP = JSON.parse(readFileSync(resolve(import.meta.dir, '../db/process-map.json'), 'utf8'));
const OUT = resolve(import.meta.dir, '../db/seed/showcase.sql');

// Справочники — из шаблона сидов.
const CUSTOMER = '66666666-6666-6666-6666-666666666601';
const CONTRACT = 'ee000000-0000-0000-0000-000000000003';
const ORG = '55555555-5555-5555-5555-555555555501';
const SUPPLIER = '66666666-6666-6666-6666-666666666604';
const WH = '44444444-4444-4444-4444-444444444401';
const BATCH = 'dd000000-0000-0000-0000-000000000001';
const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';

/** Место хранения по состоянию: где товар физически. */
const PLACE: Record<string, { cell: string; zone: string }> = {
  new: { cell: '88888888-8888-8888-8888-888888888801', zone: '99999999-9999-9999-9999-999999999901' },
  in_work: { cell: '88888888-8888-8888-8888-888888888801', zone: '99999999-9999-9999-9999-999999999901' },
  partially_ordered: { cell: '88888888-8888-8888-8888-888888888801', zone: '99999999-9999-9999-9999-999999999901' },
  reserve: { cell: '88888888-8888-8888-8888-888888888809', zone: '99999999-9999-9999-9999-999999999908' },
  assembly: { cell: '88888888-8888-8888-8888-888888888809', zone: '99999999-9999-9999-9999-999999999908' },
  ready_to_ship: { cell: '88888888-8888-8888-8888-888888888808', zone: '99999999-9999-9999-9999-999999999907' },
  to_stock: { cell: '88888888-8888-8888-8888-888888888802', zone: '99999999-9999-9999-9999-999999999902' },
  acceptance: { cell: '88888888-8888-8888-8888-888888888801', zone: '99999999-9999-9999-9999-999999999901' },
  shipped: { cell: '88888888-8888-8888-8888-888888888810', zone: '99999999-9999-9999-9999-999999999909' },
  closed: { cell: '88888888-8888-8888-8888-888888888810', zone: '99999999-9999-9999-9999-999999999909' },
  return: { cell: '88888888-8888-8888-8888-888888888806', zone: '99999999-9999-9999-9999-999999999905' },
};

/** Товар на складе — только у этих состояний: остальные либо ждут, либо уехали. */
const ON_STOCK = new Set(['to_stock', 'reserve', 'assembly', 'ready_to_ship', 'acceptance', 'return']);

/** Какие документы существуют при состоянии строки. */
function documents(status: string): string[] {
  if (['ordered', 'partially_ordered'].includes(status)) return ['supplier'];
  if (['paid', 'in_transit'].includes(status)) return ['supplier', 'receipt'];
  if (['acceptance', 'to_stock', 'reserve', 'assembly', 'ready_to_ship'].includes(status)) return ['supplier', 'receipt'];
  if (status === 'shipped') return ['supplier', 'receipt', 'shipment'];
  if (status === 'closed') return ['supplier', 'receipt', 'shipment'];
  if (status === 'return') return ['supplier', 'receipt', 'return'];
  return [];
}

const NOM = [
  '77777777-7777-7777-7777-777777777701',
  '77777777-7777-7777-7777-777777777702',
  '77777777-7777-7777-7777-777777777703',
  '77777777-7777-7777-7777-777777777707',
  '77777777-7777-7777-7777-777777777708',
];
const FACT_NAMES = ['Масло моторное 5W-30 (5л)', 'Фильтр масляный', 'Колодки тормозные передние',
  'Фильтр салонный', 'Замена масла (работа)'];
const ARTICLES = ['MOT5W30-5L', 'FLT-OIL-001', 'BRK-FR-001', 'FLT-CAB-001', 'SRV-OIL-001'];

const hex = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();

/**
 * Идентификатор витринной строки и её документов.
 *
 * Первая группа дополняется нулями ВСЕГДА до 8 символов, последняя — ровно 12
 * (4 нуля + процесс + состояние + 4 нуля). Две ошибки подряд были здесь:
 * сначала `e` + 4 нуля дало 5 символов, потом двухсимвольный `f3` дал 9.
 * Postgres на оба отвечает «invalid input syntax for type uuid».
 */
const id = (prefix: string, p: number, s: number): string =>
  `${prefix.padEnd(8, '0')}-0000-0000-0000-0000${hex(p)}${hex(s)}0000`;

const rows: { process: string; status: string; steps: number[]; p: number; s: number }[] = [];

MAP.scenarios.forEach((proc: { id: string; steps: { n: number; status: string | null }[] }, p: number) => {
  const byStatus = new Map<string, number[]>();
  for (const st of proc.steps) {
    if (!st.status) continue;
    const list = byStatus.get(st.status) ?? [];
    list.push(st.n);
    byStatus.set(st.status, list);
  }
  let s = 0;
  for (const [status, steps] of byStatus) {
    rows.push({ process: proc.id, status, steps, p, s: s++ });
  }
});

const sql: string[] = [
  `-- ВИТРИНА: по строке на каждый этап каждого процесса + необходимые документы.`,
  `--`,
  `-- Сгенерировано scripts/gen-showcase-seed.ts из db/process-map.json.`,
  `-- Строк: ${rows.length} (уникальные пары «процесс × состояние» из ${MAP.scenarios.length} процессов,`,
  `-- ${MAP.scenarios.reduce((n: number, p: { steps: unknown[] }) => n + p.steps.length, 0)} шагов).`,
  `--`,
  `-- Запуск ОТДЕЛЬНО: bun run db:seed --showcase`,
  `-- В --all не входит намеренно: 63 строки и десятки документов сделали бы`,
  `-- состояние e2e непредсказуемым.`,
  ``,
  `-- Чистим только своё: префиксы d0/e0/f1..f4 — витринные.`,
  `delete from line_mark where id in (select id from line where internal_order_number like 'ВИТ-%');`,
  `delete from line_fact where id in (select id from line where internal_order_number like 'ВИТ-%');`,
  `delete from stock_move where line_id in (select id from line where internal_order_number like 'ВИТ-%');`,
  `delete from line where internal_order_number like 'ВИТ-%';`,
  `delete from shipment where number like 'ВИТ-%';`,
  `delete from receipt where number like 'ВИТ-%';`,
  `delete from supplier_order where number like 'ВИТ-%';`,
  `delete from return_order where number like 'ВИТ-%';`,
  `delete from customer_order where number like 'ВИТ-%';`,
  ``,
];

for (const r of rows) {
  const title = `${r.process}/${r.status}`;
  const ni = r.s % NOM.length;
  const place = PLACE[r.status] ?? PLACE.new!;
  const lineId = id('d', r.p, r.s);
  const orderId = id('e', r.p, r.s);
  const docs = documents(r.status);
  const num = `ВИТ-${r.process.toUpperCase().slice(0, 8)}-${String(r.s + 1).padStart(2, '0')}`;

  sql.push(
    `-- ${title} (шаги ${r.steps.join(', ')})`,
    `insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)`,
    `values ('${orderId}', '${num}', current_date, 'sale', '${num}', '${CUSTOMER}', '${CONTRACT}', '${ORG}', current_date + 7, 1200);`,
    ``,
    `insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,`,
    `                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)`,
    `values ('${lineId}', '${orderId}', 'sale', '${r.status}', 1, '${NOM[ni]}', '${CUSTOMER}', '${CONTRACT}',`,
    `        current_date, '${WH}', '${place.cell}', '${place.zone}', '${SUPPLIER}', '${BATCH}', '${num}');`,
    ``,
    `insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)`,
    `values ('${lineId}', '${num}', '${FACT_NAMES[ni]}', '1', '${ARTICLES[ni]}', 'шт', 'А123ВС777');`,
    `insert into line_mark (id, marked, marked_by_id) values ('${lineId}', false, null)`,
    `on conflict (id) do update set marked = false;`,
  );

  // Товар на складе: приход, чтобы остаток был не нулевым.
  if (ON_STOCK.has(r.status)) {
    sql.push(
      `insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)`,
      `values ('${NOM[ni]}', '${WH}', '${place.cell}', 'receipt', 5, '${lineId}', 'Витрина: ${title}');`,
    );
  }
  if (r.status === 'reserve' || r.status === 'assembly') {
    sql.push(
      `insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)`,
      `values ('${NOM[ni]}', '${WH}', '${place.cell}', 'reserve', 1, '${lineId}', 'Витрина: резерв ${title}');`,
    );
  }

  if (docs.includes('supplier')) {
    sql.push(
      `insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)`,
      `values ('${id('f3', r.p, r.s)}', '${num}', current_date, 'confirmed', 'purchase', '${SUPPLIER}', '${orderId}', '${ORG}', current_date + 3, 900);`,
    );
  }
  if (docs.includes('receipt')) {
    const posted = ['to_stock', 'reserve', 'assembly', 'ready_to_ship', 'shipped', 'closed', 'return'].includes(r.status);
    sql.push(
      `insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)`,
      `values ('${id('f1', r.p, r.s)}', '${num}', current_date, 'purchase', '${SUPPLIER}', '${WH}', ${posted});`,
    );
  }
  if (docs.includes('shipment')) {
    const closed = r.status === 'closed';
    sql.push(
      `insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)`,
      `values ('${id('f2', r.p, r.s)}', '${num}', current_date, '${closed ? 'closed' : 'shipped'}', 'sale', '${CUSTOMER}', '${orderId}', '${WH}', '${place.zone}', '${CAR}');`,
    );
  }
  if (docs.includes('return')) {
    sql.push(
      `insert into return_order (id, number, date, kind, status, operation, counterparty_id, warehouse_id)`,
      `values ('${id('f4', r.p, r.s)}', '${num}', current_date, 'client', 'new', 'sale', '${CUSTOMER}', '${WH}');`,
    );
  }

  sql.push('');
}

writeFileSync(OUT, `${sql.join('\n')}\n`, 'utf8');

const byStatus = new Map<string, number>();
for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

console.log(`db/seed/showcase.sql: строк ${rows.length} (процессов ${MAP.scenarios.length})`);
console.log('по состояниям:', [...byStatus.entries()].sort().map(([s, n]) => `${s}=${n}`).join(' '));
for (const p of MAP.scenarios) {
  const n = rows.filter((r) => r.process === p.id).length;
  console.log(`  ${p.id.padEnd(17)} строк=${String(n).padStart(2)}  шагов=${String(p.steps.length).padStart(2)}  ${p.title}`);
}
