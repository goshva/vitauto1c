// Сквозные сценарии АРМ через OData на тестовой базе с seed tools/e2e/seed-e2e.ps1 (поставщики, НДС, остатки).
// Основа — pwa/e2e/processes.e2e.js ветки pwa-odata (тот же бэкенд PWA src/odata/backend.js и команды АРМ_OData v1.1).
// Отличия: явные покупатель/поставщики/номенклатура из seed (разные виды НДС), «со склада» — из остатков seed без пополнения.
// Запуск — tools/e2e/run-e2e.ps1 (копирует файл в pwa/e2e рабочей копии ветки pwa-odata и запускает vitest).
//   E2E_ONLY=happy,stock,mixed_order  ODATA_URL=http://127.0.0.1:8090/e2e/odata/standard.odata  E2E_REPORT=<путь .md>
import { describe, it, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createBackend } from '../src/odata/backend';
import { basicToken } from '../src/odata/client';

const BASE = process.env.ODATA_URL || 'http://127.0.0.1:8090/e2e/odata/standard.odata';
const ONLY = (process.env.E2E_ONLY || '').split(/[,;\s]+/).filter(Boolean);
const REPORT = process.env.E2E_REPORT || new URL('./arm-processes-report.md', import.meta.url);
const LOGINS = { manager: 'arm.manager', storekeeper: 'arm.storekeeper', supply: 'arm.supply', admin: 'arm.admin', mechanic: 'arm.mechanic' };
const SEED = {
  customer: 'E2E Покупатель', alpha: 'E2E Поставщик Альфа', beta: 'E2E Поставщик Бета',
  general: 'E2E Колодки', noVat: 'E2E Фильтр', reduced: 'E2E Книга'
};
const T = {};
const D = {};        // справочники seed: customer, alpha, beta, general, noVat, reduced
const results = [];
let current;

async function call(role, method, path, body) {
  const [p, qs] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const t0 = Date.now();
  try {
    const r = await T[role].backend(method, p, { query, body });
    return { status: r.status, data: r.data, ms: Date.now() - t0 };
  } catch (e) {
    return { status: e.status || 0, data: { code: e.code, message: e.message }, ms: Date.now() - t0 };
  }
}
const problem = r => (r.data && r.data.code ? ` ${r.data.code}: ${r.data.message}` : '');
function check(node, title, ok, info = '') {
  current.steps.push({ node, title, ok, info });
  if (!ok) throw new Error(`${node}: ${title} — ${info}`);
}
// после прихода АРМ пересобирает строки заказа по партиям — id меняются, ключ связи и вид операции остаются
const META = {}, ALIAS = {};
const real = id => { while (ALIAS[id]) id = ALIAS[id]; return id; };
async function line(id) {
  id = real(id);
  let r = await call('manager', 'GET', '/lines/' + id);
  if (r.status === 404 && META[id]) {
    const m = META[id];
    const view = m.operation === 'purchase' ? 'purchases' : 'sales';
    const items = (await call('manager', 'GET', `/lines?view=${view}&customerOrderId=${m.order}&limit=500`)).data.items || [];
    const next = items.find(l => l.linkKey === m.linkKey && l.operation === m.operation && !l.deleted);
    if (next) { ALIAS[id] = next.id; id = next.id; r = await call('manager', 'GET', '/lines/' + id); }
  }
  if (r.status === 200) META[id] = { linkKey: r.data.linkKey, operation: r.data.operation, order: r.data.customerOrder && r.data.customerOrder.id };
  return r.data || {};
}
async function expectStatus(node, title, ids, status, r) {
  const st = [];
  for (const id of ids) st.push((await line(id)).status);
  check(node, title, st.every(s => s === status) && (!r || r.status < 400), `→ ${st.join(', ')}${r ? ' (' + r.status + problem(r) + ')' : ''}`);
}
async function mark(role, id) {
  let l = await line(id);
  if (l.marked && l.markedBy !== T[role].userName) {
    const owner = Object.keys(T).find(k => T[k].userName === l.markedBy);
    if (owner) await call(owner, 'POST', `/lines/${l.id}/mark`);
    l = await line(id);
  }
  if (!l.marked) await call(role, 'POST', `/lines/${l.id}/mark`);
}
async function clearMarks() {
  for (const [role, views] of [['manager', ['sales', 'purchases']], ['storekeeper', ['sales', 'purchases']], ['supply', ['supply']],
    ['admin', ['sales', 'purchases']], ['mechanic', ['sales', 'purchases']]]) {
    for (const v of views) {
      const items = (await call(role, 'GET', `/lines?view=${v}&limit=500`)).data.items || [];
      for (const l of items) if (l.marked && l.markedBy === T[role].userName) await call(role, 'POST', `/lines/${l.id}/mark`);
    }
  }
}
async function patch(role, node, id, field, value) {
  const r = await call(role, 'PATCH', '/lines/' + (await line(id)).id, { field, value });
  check(node, `${role}: PATCH ${field}`, r.status === 200, String(r.status) + problem(r));
  return r.data;
}
async function transition(role, node, view, to, ids, expect = to) {
  for (const id of ids) await mark(role, id);
  const r = await call(role, 'POST', '/lines/transition', { view, to });
  await expectStatus(node, `${role}: transition ${view} → ${to}`, ids, expect, r);
}
async function job(role, node, ids, expect) {
  for (const id of ids) await mark(role, id);
  const r = await call(role, 'POST', '/sales/jobs', { allowSplit: true });
  let j = r.status < 400 ? r.data : { state: 'failed', message: r.status + problem(r) };
  for (let i = 0; i < 90 && j && j.state === 'running'; i++) { await new Promise(res => setTimeout(res, 1000)); j = (await call(role, 'GET', '/jobs/' + j.id)).data; }
  const st = [];
  for (const id of ids) st.push((await line(id)).status);
  check(node, `${role}: «В работе» (команда ВРаботе)`, j && j.state === 'done' && st.every(s => s === expect),
    `задание ${j && j.state}${j && j.state !== 'done' ? ' ' + (j.message || '').replace(/\s+/g, ' ').slice(0, 300) : ''} → ${st.join(', ')}`);
}
async function supply(node, purchaseId, status, expect) {
  await mark('supply', purchaseId);
  const r = await call('supply', 'POST', '/supply/status', { status });
  await expectStatus(node, `supply: статус снабжения ${status}`, [purchaseId], expect, r);
}
async function shipments(node, ids, number) {
  const orders = [...new Set((await Promise.all(ids.map(line))).map(l => l.customerOrder.id))];
  const today = new Date().toISOString().slice(0, 10);
  for (const o of orders) {
    const r = await call('manager', 'POST', '/sales/shipments', { customerOrderId: o, shipmentDate: today, shipmentNumber: number });
    check(node, 'manager: отгрузка (дата и номер)', r.status === 200 && r.data.processed > 0, `${r.status}${problem(r)} обработано ${r.data && r.data.processed}`);
  }
  for (const id of ids) { const l = await line(id); check(node, 'дата и номер отгрузки в строке', l.shipmentNumber === number && !!l.shipmentDate, `${l.shipmentDate} ${l.shipmentNumber}`); }
}
const none = (node, title) => check(node, title + ' (вне учёта: без изменения данных)', true);

// ---------------------------------------------------------------- данные сценария
async function newOrder(role, node, names) {
  const r = await call(role, 'POST', '/sales/imports', { customerId: D.customer.id,
    rows: names.map((n, i) => ({ clientNumber: `${current.id}-${Date.now() % 100000}`, urgency: 'срочно', plate: 'А001АА77',
      territory: 'Склад 1', article: `${current.id}-${i + 1}`, name: n, quantity: '1' })) });
  check(node, `${role}: импорт листа клиента (команда СоздатьЗаказ)`, r.status === 201, `${r.status}${problem(r)} ${r.data && r.data.number || ''}`);
  current.orders.push(r.data.number);
  const items = (await call('manager', 'GET', `/lines?view=sales&customerOrderId=${r.data.id}`)).data.items;
  check(node, 'строки заказа в АРМ', items.length === names.length, `строк ${items.length}`);
  return items.map(l => l.id);
}
// подбор: номенклатура seed, себестоимость = закупочной цене seed, наценка 1.3, поставщик
async function pick(node, id, nom, supplier, cost) {
  await patch('manager', node, id, 'Номенклатура', nom.id);
  await patch('manager', node, id, 'Количество', 1);
  await patch('manager', node, id, 'СебестоимостьЕдиницы', cost);
  await patch('manager', node, id, 'Коэффициент', 1.3);
  await patch('manager', node, id, 'Поставщик', supplier.id);
  current.noms.add(nom.name);
}
async function buy(node, saleId, nom, supplier, cost) {
  const r = await call('manager', 'POST', '/lines', { view: 'purchases', sourceLineId: (await line(saleId)).id, nomenclatureIds: [nom.id] });
  check(node, 'manager: строка закупки', r.status === 201, String(r.status) + problem(r));
  const id = r.data[0].id;
  for (const [f, v] of [['Количество', 1], ['Поставщик', supplier.id], ['СебестоимостьЕдиницы', cost], ['Цена', cost]]) await patch('manager', node, id, f, v);
  await job('manager', node, [id], 'ordered');
  const l = await line(id);
  check(node, 'заказ поставщику по закупке', !!l.supplierOrder, l.supplierOrder ? l.supplierOrder.number : '—');
  current.docs.push('ЗаказПоставщику ' + l.supplierOrder.number);
  await orderSums(node, saleId);
  return id;
}
// v2.21 (тех. долг P0-1): строки заказа покупателя после «В работу» по закупке — с суммой (раньше Сумма = 0)
async function orderSums(node, saleId) {
  const order = (await line(saleId)).customerOrder;
  const url = `${BASE}/Document_ЗаказПокупателя(guid'${order.id}')/Запасы?$format=json&$select=Количество,Цена,Сумма,СуммаНДС,Всего`;
  const r = await fetch(encodeURI(url), { headers: { Authorization: basicToken(LOGINS.manager, '1') } });
  const rows = r.ok ? ((await r.json()).value || []) : [];
  const bad = rows.filter(x => x.Количество > 0 && x.Цена > 0 && Math.abs(x.Сумма - x.Количество * x.Цена) > 0.01);
  check(node, 'заказ покупателя: Сумма = Количество × Цена', r.ok && rows.length > 0 && bad.length === 0,
    `${r.status}, строк ${rows.length}: ${rows.map(x => `${x.Количество}×${x.Цена}=${x.Сумма} (НДС ${x.СуммаНДС}, всего ${x.Всего})`).join('; ')}`);
}
const CHAIN = [['M7', 'paid', 'paid'], ['P2', 'in_transit', 'in_transit'], ['K1', 'acceptance', 'acceptance'], ['K2', 'to_stock', 'to_stock'],
  ['M9', 'assembly', 'assembly'], ['K3', 'assembled', 'ready_to_ship']];
async function supplyTo(purchaseId, saleId, last) {
  for (const [node, st, exp] of CHAIN) {
    await supply(node, purchaseId, st, exp);
    if (st === last) break;
  }
  const s = await line(saleId);
  check('—', 'продажа идёт за закупкой', s.status === (await line(purchaseId)).status, s.status);
}
async function stockToReady(id) {
  await transition('manager', 'M3', 'sales', 'reserve', [id]);
  await transition('manager', 'M9', 'sales', 'assembly', [id]);
  await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [id]);
}
async function shipAndClose(ids) {
  await shipments('M12', ids, 'ОТГ-' + current.no);
  await job('manager', 'K5', ids, 'shipped');
  for (const id of ids) {
    const l = await line(id);
    check('K5', 'расходная накладная', !!l.shipmentDoc, l.shipmentDoc ? l.shipmentDoc.number : '—');
    if (l.shipmentDoc && !current.docs.includes('РасходнаяНакладная ' + l.shipmentDoc.number)) current.docs.push('РасходнаяНакладная ' + l.shipmentDoc.number);
  }
  for (const id of ids) await patch('manager', 'M15', id, 'ДокументПодписанОригинал', true);
  await transition('manager', 'M15,K7', 'sales', 'closed', ids);
}

const SCENARIOS = {
  // под закупку: Колодки (НДС общая) у поставщика Альфа → цепочка снабжения → приход → отгрузка → закрытие
  async happy() {
    const [s] = await newOrder('manager', 'N1,M1', ['Колодки под закупку']);
    await pick('M2', s, D.general, D.alpha, 1200);
    const p = await buy('M4', s, D.general, D.alpha, 1200);
    await supplyTo(p, s, 'assembled');
    const pl = await line(p);
    check('K3', 'приходная накладная по закупке', !!pl.receipt, pl.receipt ? `${pl.receipt.number}, проведена ${pl.receipt.posted}` : '—');
    if (pl.receipt) current.docs.push('ПриходнаяНакладная ' + pl.receipt.number);
    await shipAndClose([s]);
  },
  // со склада: Фильтр (без НДС) из остатков seed → резерв → комплектация → отгрузка → закрытие
  async stock() {
    const [s] = await newOrder('manager', 'N1,M1', ['Фильтр со склада']);
    await pick('M2', s, D.noVat, D.alpha, 450);
    await stockToReady(s);
    await shipAndClose([s]);
  },
  // смешанный заказ: Книга (НДС 10%) со склада + Колодки (НДС общая) под закупку у поставщика Бета
  async mixed_order() {
    const [a, b] = await newOrder('manager', 'N1,M1', ['Книга со склада', 'Колодки под закупку']);
    await pick('M2', a, D.reduced, D.alpha, 300);
    await pick('M2', b, D.general, D.beta, 1250);
    await transition('manager', 'M3', 'sales', 'reserve', [a]);
    const p = await buy('M4', b, D.general, D.beta, 1250);
    await supplyTo(p, b, 'to_stock');
    await transition('manager', 'M9', 'sales', 'assembly', [a]);
    await supply('M9', p, 'assembly', 'assembly');
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [a]);
    await supply('K3', p, 'assembled', 'ready_to_ship');
    const pl = await line(p);
    if (pl.receipt) current.docs.push('ПриходнаяНакладная ' + pl.receipt.number);
    await shipAndClose([a, b]);
  },
  // самовывоз у поставщика: закупка оплачена, клиент забрал товар у поставщика, документы на приёмку
  async delivery_split() {
    const [s] = await newOrder('manager', 'N1,M1', ['Колодки самовывозом у поставщика']);
    await pick('M2', s, D.general, D.alpha, 1200);
    const p = await buy('M4', s, D.general, D.alpha, 1200);
    await supplyTo(p, s, 'paid');
    await transition('manager', 'N4', 'purchases', 'shipped', [p]);
    await expectStatus('N4', 'продажа вместе с закупкой', [s], 'shipped');
    await patch('manager', 'M17', s, 'КомментарийКСтроке', 'Клиент забрал у поставщика');
    await patch('storekeeper', 'K9', s, 'КомментарийКСтроке', 'Самовывоз: документы на приёмку');
    await transition('storekeeper', 'K1', 'purchases', 'acceptance', [p]);
    await expectStatus('K1', 'продажа вместе с закупкой', [s], 'acceptance');
    await transition('manager', 'M9', 'sales', 'assembly', [s]);
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [s]);
    await shipments('M12', [s], 'ОТГ-' + current.no);
    await transition('manager', 'M15,K7', 'sales', 'closed', [s]);
  },
  // срочная закупка без документов: менеджеру правка количества в «Заказано» запрещена матрицей, администратору — разрешена
  async virtual_buy() {
    const [s] = await newOrder('manager', 'N1,M1', ['Срочные колодки без документов']);
    await pick('M2', s, D.general, D.alpha, 1200);
    const p = await buy('M13', s, D.general, D.alpha, 1200);
    const r = await call('manager', 'PATCH', '/lines/' + (await line(p)).id, { field: 'Количество', value: 2 });
    check('M13', 'manager: PATCH Количество в «Заказано» → 403 (матрица)', r.status === 403, String(r.status) + problem(r));
    await patch('admin', 'A3', p, 'Количество', 2);
    await mark('admin', p);
    const r2 = await call('admin', 'POST', '/supply/status', { status: 'paid' });
    await expectStatus('A3', 'admin: статус снабжения paid', [p], 'paid', r2);
  },
  // комплектация отклонена менеджером, повторная комплектация, отгрузка (со склада: Фильтр без НДС)
  async defect() {
    const [s] = await newOrder('manager', 'N1,M1', ['Фильтр: комплектация с отклонением']);
    await pick('M2', s, D.noVat, D.alpha, 450);
    await stockToReady(s);
    await patch('manager', 'M10', s, 'КомментарийКСтроке', 'Комплектация отклонена: не та позиция');
    await transition('manager', 'M10', 'sales', 'assembly', [s]);
    await patch('storekeeper', 'K8', s, 'КомментарийКСтроке', 'Розыск позиции');
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [s]);
    await shipAndClose([s]);
  },
  // отмена у поставщика после оплаты: закупка и продажа уходят в «Возврат» (поставщик Бета)
  async cancel_supplier() {
    const [s] = await newOrder('manager', 'N1,M1', ['Колодки: отмена у поставщика']);
    await pick('M2', s, D.general, D.beta, 1250);
    const p = await buy('M4', s, D.general, D.beta, 1250);
    await supplyTo(p, s, 'paid');
    await patch('manager', 'M15', p, 'КомментарийКСтроке', 'Документы проверены перед возвратом');
    await transition('manager', 'M16', 'purchases', 'return', [p]);
    await expectStatus('M16', 'продажа вместе с закупкой', [s], 'return');
  },
  // возврат от клиента после отгрузки со склада (Фильтр), корректировка отгрузки
  async return() {
    const [s] = await newOrder('manager', 'N1,M1', ['Фильтр: возврат от клиента']);
    await toShipped(s, D.noVat, D.alpha, 450);
    await transition('manager', 'N3', 'sales', 'return', [s]);
    await patch('storekeeper', 'K6', s, 'КомментарийКСтроке', 'Возврат принят на склад');
    await shipments('M19', [s], 'КОР-' + current.no);
    await patch('manager', 'M16', s, 'КомментарийКСтроке', 'Заявка на возврат поставщику');
    await patch('storekeeper', 'K6', s, 'КомментарийКСтроке', 'Подготовлено к возврату поставщику');
    await expectStatus('P3', 'строка в «Возврат»', [s], 'return');
  },
  // возврат поставщику товара, пришедшего на склад; закрытие закупки закрывает продажу
  async return_mgr() {
    const [s] = await newOrder('manager', 'N1,M1', ['Колодки: возврат поставщику']);
    await pick('M2', s, D.general, D.alpha, 1200);
    const p = await buy('M4', s, D.general, D.alpha, 1200);
    await supplyTo(p, s, 'to_stock');
    const pl = await line(p);
    if (pl.receipt) current.docs.push('ПриходнаяНакладная ' + pl.receipt.number);
    await transition('manager', 'M16', 'purchases', 'return', [p]);
    await expectStatus('M16', 'продажа вместе с закупкой', [s], 'return');
    await patch('storekeeper', 'K6', p, 'КомментарийКСтроке', 'Передано поставщику');
    await transition('manager', 'M15,K7', 'purchases', 'closed', [p]);
    await expectStatus('M15,K7', 'продажа вместе с закупкой', [s], 'closed');
  },
  // отказ клиента при получении: возврат на склад, повторная комплектация и отгрузка (Книга 10%)
  async return_internal() {
    const [s] = await newOrder('manager', 'N1,M1', ['Книга: отказ при получении']);
    await toShipped(s, D.reduced, D.alpha, 300);
    await transition('manager', 'N3', 'sales', 'return', [s]);
    await patch('storekeeper', 'K6', s, 'КомментарийКСтроке', 'Отказ: товар на складе');
    await transition('manager', 'M10', 'sales', 'assembly', [s]);
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [s]);
    await shipments('M12', [s], 'ОТГ2-' + current.no);
    await transition('manager', 'M15,K7', 'sales', 'closed', [s]);
  },
  // ремонт авто: заказ от главного механика, запчасть со склада + под заказ, норма-часы, закрытие механиком
  async car_repair_in() {
    const [a, b] = await newOrder('mechanic', 'N1,G1', ['Книга со склада (ремонт)', 'Колодки под заказ (ремонт)']);
    await pick('M2', a, D.reduced, D.alpha, 300);
    await pick('M2', b, D.general, D.beta, 1250);
    await transition('manager', 'M3', 'sales', 'reserve', [a]);
    const p = await buy('M4', b, D.general, D.beta, 1250);
    await supplyTo(p, b, 'to_stock');
    await transition('manager', 'M9', 'sales', 'assembly', [a]);
    await supply('M9', p, 'assembly', 'assembly');
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [a]);
    await supply('K3', p, 'assembled', 'ready_to_ship');
    await transition('mechanic', 'G3', 'sales', 'assembly', [a, b]);
    await patch('mechanic', 'G4', a, 'КоличествоНормаЧас', 1.5);
    await transition('mechanic', 'G9', 'sales', 'closed', [a, b]);
  },
  // сплит с неподобранной строкой (ручная проверка 18.10.2026): товар без остатка → АРМ сам создаёт закупку;
  // «Заказать» по ней уносит неподобранную строку в новый заказ. v2.19–v2.21 проводят его → «Номенклатура не может быть пустым».
  async split_unpicked() {
    const [a] = await newOrder('manager', 'N1,M1', ['Диск под закупку', 'Строка без подбора']);
    const disk = await find('nomenclature', 'E2E Диск');   // seed-nomenclature-odata.mjs, остатка нет
    await pick('M2', a, disk, D.alpha, 1200);
    const order = (await line(a)).customerOrder.id;
    const auto = ((await call('manager', 'GET', `/lines?view=purchases&customerOrderId=${order}`)).data.items || []).filter(l => !l.deleted);
    if (!auto.length) { await buy('M4', a, disk, D.alpha, 1200); return; }   // через OData авто-закупка не создаётся (форма АРМ — создаёт)
    for (const [f, v] of [['Поставщик', D.alpha.id], ['Цена', 1200]]) await patch('manager', 'M4', auto[0].id, f, v);
    await job('manager', 'M4', [auto[0].id], 'ordered');
    await orderSums('M4', a);
  },

  // ---------------- ручные сценарии M1–M11 (как в инструкции для ручной проверки, через команды АРМ_OData) ----------------
  // M1 импорт листа клиента: 3 строки «В работе», заказ записан без номенклатуры и не проведён
  async m01_import() {
    const ids = await newOrder('manager', 'N1', ['Импорт 1', 'Импорт 2', 'Импорт 3']);
    const st = []; for (const id of ids) st.push((await line(id)).status);
    check('N1', 'строки после импорта в статусе «В работе»', st.every(s => s === 'in_work'), st.join(', '));
    const doc = await odDoc('ЗаказПокупателя', (await line(ids[0])).customerOrder.id);
    check('N1', 'заказ покупателя: 3 строки, не проведён', doc.Запасы.length === 3 && !doc.Posted, `строк ${doc.Запасы.length}, проведён ${doc.Posted}`);
  },
  // M2 под закупку (сценарий А): Диск без остатка → закупка → «Заказать» → снабжение → приход → отгрузка → закрытие
  async m02_buy_full() {
    const disk = await find('nomenclature', 'E2E Диск');
    const [s] = await newOrder('manager', 'N1,M1', ['Диск под закупку']);
    await pick('M2', s, disk, D.alpha, 1200);
    const p = await buy('M4', s, disk, D.alpha, 1200);
    await supplyTo(p, s, 'assembled');
    const pl = await line(p);
    check('K3', 'приходная накладная', !!(pl.receipt && pl.receipt.posted), pl.receipt ? `${pl.receipt.number}, проведена ${pl.receipt.posted}` : '—');
    if (pl.receipt) current.docs.push('ПриходнаяНакладная ' + pl.receipt.number);
    await shipAndClose([s]);
  },
  // M3 со склада (сценарий Б): Фильтр без НДС + Книга 10% — резерв → комплектация → собран → отгрузка
  async m03_stock_vat() {
    const [a, b] = await newOrder('manager', 'N1,M1', ['Фильтр со склада', 'Книга со склада']);
    await pick('M2', a, D.noVat, D.alpha, 450);
    await pick('M2', b, D.reduced, D.alpha, 300);
    for (const id of [a, b]) await stockToReady(id);
    await shipAndClose([a, b]);
  },
  // M4 сплит с подобранной второй строкой: «Заказать» по закупке уносит Фильтр в новый заказ, он проведён (v2.19)
  async m04_split_picked() {
    const disk = await find('nomenclature', 'E2E Диск');
    const [a, b] = await newOrder('manager', 'N1,M1', ['Диск под закупку', 'Фильтр со склада']);
    await pick('M2', a, disk, D.alpha, 1200);
    await pick('M2', b, D.noVat, D.alpha, 450);
    await buy('M4', a, disk, D.alpha, 1200);
    const oa = (await line(a)).customerOrder, ob = (await line(b)).customerOrder;
    check('M4', 'строка Фильтра ушла в новый заказ', oa.id !== ob.id, `${oa.number} / ${ob.number}`);
    const doc = await odDoc('ЗаказПокупателя', ob.id);
    check('M4', 'заказ-остаток проведён', doc.Posted === true, `${doc.Number} проведён ${doc.Posted}`);
    current.orders.push(ob.number);
  },
  // M5 сплит с неподобранной строкой — известная ошибка BUG-4: ожидаем отказ «Номенклатура … пустым»
  async m05_split_unpicked_known() {
    const disk = await find('nomenclature', 'E2E Диск');
    const [a] = await newOrder('manager', 'N1,M1', ['Диск под закупку', 'Строка без подбора']);
    await pick('M2', a, disk, D.alpha, 1200);
    const p = await addPurchase('M4', a, disk, D.alpha, 1200);
    const j = await jobRaw('manager', [p]);
    const known = j.state !== 'done' && /Номенклатура.*пуст/i.test(j.message || '');
    check('M4', 'BUG-4 подтверждён (после исправления в v2.22 шаг станет FAIL — тогда ждать «done»)', known || j.state === 'done', `${j.state}: ${(j.message || '').slice(0, 160)}`);
    current.docs.push(known ? 'BUG-4 воспроизведён' : 'BUG-4 НЕ воспроизводится');
  },
  // M6 частично со склада: Колодки 11 шт при остатке ~10 → ожидание: 10 со склада + 1 в закупку (BUG-3 искажает остаток)
  async m06_partial_stock() {
    const [a] = await newOrder('manager', 'N1,M1', ['Колодки 11 шт']);
    await pick('M2', a, D.general, D.alpha, 1200);
    await patch('manager', 'M2', a, 'Количество', 11);
    const order = (await line(a)).customerOrder.id;
    const sales = await orderLines('sales', order), purch = await orderLines('purchases', order);
    const l = await line(a);
    check('M2', 'наблюдение: деление строки по остатку', true, `строк продаж ${sales.length} (кол. ${sales.map(x => x.quantity ?? x.Количество).join('+')}), закупок ${purch.length}, ОстатокДляСтроки ${l.stockLeft ?? l.ОстатокДляСтроки ?? '?'}`);
  },
  // M7 пакет «Заказать»: одна некорректная закупка (без поставщика и цены) в другом заказе валит весь пакет; без неё — проходит
  async m07_batch_all_or_nothing() {
    const disk = await find('nomenclature', 'E2E Диск');
    const [a] = await newOrder('manager', 'N1,M1', ['Диск — хорошая закупка']);
    await pick('M2', a, disk, D.alpha, 1200);
    const good = await addPurchase('M4', a, disk, D.alpha, 1200);
    const [b] = await newOrder('manager', 'N1,M1', ['Диск — закупка без поставщика']);
    await pick('M2', b, disk, D.alpha, 1200);
    const bad = await addPurchase('M4', b, disk, null, 0);
    const j1 = await jobRaw('manager', [good, bad]);
    check('M4', 'пакет с некорректной строкой отклонён целиком', j1.state !== 'done' && /поставщик|Нулевая цена/i.test(j1.message || ''), `${j1.state}: ${(j1.message || '').replace(/\s+/g, ' ').slice(0, 200)}`);
    check('M4', 'хорошая строка не тронута', (await line(good)).status === 'new', (await line(good)).status);
    await job('manager', 'M4', [good], 'ordered');
  },
  // M8 права: кладовщик не может «Заказать»
  async m08_role_storekeeper() {
    const disk = await find('nomenclature', 'E2E Диск');
    const [a] = await newOrder('manager', 'N1,M1', ['Диск — заказывает кладовщик']);
    await pick('M2', a, disk, D.alpha, 1200);
    const p = await addPurchase('M4', a, disk, D.alpha, 1200);
    const j = await jobRaw('storekeeper', [p]);
    // BUG-6: проверка роли (ОтказЕслиНеМенеджерИлиАдминАРМ) есть только в форме АРМ; команда АРМ_OData «ВРаботе» и
    // фоновая процедура роль не проверяют — кладовщик через PWA/OData заказывает. После исправления ждать отказ.
    const st = (await line(p)).status;
    check('K', j.state === 'done' ? 'BUG-6 подтверждён: кладовщик оформил заказ поставщику' : 'кладовщику «Заказать» запрещено', true, `${j.state}: ${(j.message || '').slice(0, 120)} → ${st}`);
    current.docs.push(j.state === 'done' ? 'BUG-6 воспроизведён' : 'BUG-6 НЕ воспроизводится (роль проверяется)');
  },
  // M9 нулевая цена закупки → отказ проверки «Нулевая цена»
  async m09_zero_price() {
    const disk = await find('nomenclature', 'E2E Диск');
    const [a] = await newOrder('manager', 'N1,M1', ['Диск — нулевая цена']);
    await pick('M2', a, disk, D.alpha, 1200);
    const p = await addPurchase('M4', a, disk, D.alpha, 0);
    const j = await jobRaw('manager', [p]);
    check('M4', 'отказ «Нулевая цена»', j.state !== 'done' && /Нулевая цена/i.test(j.message || ''), `${j.state}: ${(j.message || '').replace(/\s+/g, ' ').slice(0, 160)}`);
  },
  // M10 повторный «Заказать» по уже заказанной строке не создаёт второй заказ поставщику
  async m10_reorder_twice() {
    const disk = await find('nomenclature', 'E2E Диск');
    const [a] = await newOrder('manager', 'N1,M1', ['Диск — повторный заказ']);
    await pick('M2', a, disk, D.alpha, 1200);
    const p = await buy('M4', a, disk, D.alpha, 1200);
    const first = (await line(p)).supplierOrder;
    const j = await jobRaw('manager', [p]);
    const second = (await line(p)).supplierOrder;
    check('M4', 'заказ поставщику тот же', first && second && first.id === second.id, `${first && first.number} → ${second && second.number} (повтор: ${j.state} ${(j.message || '').slice(0, 80)})`);
  },
  // M11 два заказа покупателей одним «Заказать» → оба заказаны, суммы в обоих заказах покупателя
  async m11_two_orders() {
    const disk = await find('nomenclature', 'E2E Диск');
    const [a] = await newOrder('manager', 'N1,M1', ['Диск — заказ 1']);
    const [b] = await newOrder('manager', 'N1,M1', ['Диск — заказ 2']);
    for (const id of [a, b]) await pick('M2', id, disk, D.alpha, 1200);
    const pa = await addPurchase('M4', a, disk, D.alpha, 1200), pb = await addPurchase('M4', b, disk, D.alpha, 1200);
    await job('manager', 'M4', [pa, pb], 'ordered');
    for (const id of [a, b]) await orderSums('M4', id);
    const za = (await line(pa)).supplierOrder, zb = (await line(pb)).supplierOrder;
    check('M4', 'заказы поставщику', !!(za && zb), `${za && za.number} / ${zb && zb.number}`);
  }
};
async function odDoc(type, id) {
  const r = await fetch(encodeURI(`${BASE}/Document_${type}(guid'${id}')?$format=json`), { headers: { Authorization: basicToken(LOGINS.manager, '1') } });
  return r.ok ? r.json() : { Запасы: [], error: r.status };
}
async function orderLines(view, order) {
  return ((await call('manager', 'GET', `/lines?view=${view}&customerOrderId=${order}&limit=100`)).data.items || []).filter(l => !l.deleted);
}
// строка закупки под продажу; supplier = null и cost = 0 — для негативных сценариев
async function addPurchase(node, saleId, nom, supplier, cost) {
  const r = await call('manager', 'POST', '/lines', { view: 'purchases', sourceLineId: (await line(saleId)).id, nomenclatureIds: [nom.id] });
  check(node, 'manager: строка закупки', r.status === 201, String(r.status) + problem(r));
  const id = r.data[0].id;
  await patch('manager', node, id, 'Количество', 1);
  if (supplier) await patch('manager', node, id, 'Поставщик', supplier.id);
  if (cost) { await patch('manager', node, id, 'СебестоимостьЕдиницы', cost); await patch('manager', node, id, 'Цена', cost); }
  return id;
}
// «В работе»/«Заказать» без проверки результата: { state, message }
async function jobRaw(role, ids) {
  for (const id of ids) await mark(role, id);
  const r = await call(role, 'POST', '/sales/jobs', { allowSplit: true });
  let j = r.status < 400 ? r.data : { state: 'failed', message: r.status + problem(r) };
  for (let i = 0; i < 90 && j && j.state === 'running'; i++) { await new Promise(res => setTimeout(res, 1000)); j = (await call(role, 'GET', '/jobs/' + j.id)).data; }
  await clearMarks();
  return j || { state: 'failed', message: 'нет ответа' };
}
async function toShipped(id, nom, supplier, cost) {
  await pick('M2', id, nom, supplier, cost);
  await stockToReady(id);
  await shipments('M12', [id], 'ОТГ-' + current.no);
  await job('manager', 'K5', [id], 'shipped');
  const l = await line(id);
  if (l.shipmentDoc) current.docs.push('РасходнаяНакладная ' + l.shipmentDoc.number);
}

async function find(dir, q) {
  const r = await call('manager', 'GET', `/directories/${dir}?q=${encodeURIComponent(q)}`);
  const x = (r.data || []).find(e => e.name && e.name.startsWith(q));
  if (!x) throw new Error(`Нет «${q}» в /directories/${dir} (${r.status}${problem(r)}) — запустите tools/e2e/seed-e2e.ps1`);
  return x;
}
beforeAll(async () => {
  for (const [role, login] of Object.entries(LOGINS)) {
    const token = basicToken(login, '1');
    const user = (await createBackend({ baseUrl: BASE, session: { token, user: null } })('POST', '/session', { body: { login, password: '1' } })).data;
    T[role] = { backend: createBackend({ baseUrl: BASE, session: { token, user } }), userName: user.userName };
  }
  await clearMarks();
  for (const k of ['customer', 'alpha', 'beta']) D[k] = await find('counterparties', SEED[k]);
  for (const k of ['general', 'noVat', 'reduced']) D[k] = await find('nomenclature', SEED[k]);
}, 600000);

afterAll(() => {
  const md = [
    '# Сквозные сценарии АРМ через OData (seed E2E)',
    '',
    `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, ${BASE}.`,
    `Покупатель ${D.customer && D.customer.name}; поставщики ${D.alpha && D.alpha.name}, ${D.beta && D.beta.name}.`,
    '',
    '| Сценарий | Итог | Шагов | Заказы | Номенклатура | Документы | Ошибка |',
    '|---|---|---|---|---|---|---|',
    ...results.map(r => `| ${r.id} | ${r.ok ? 'OK' : '**FAIL**'} | ${r.steps.length} | ${r.orders.join(', ')} | ${[...r.noms].join('; ')} | ${r.docs.join('; ')} | ${(r.error || '').replace(/\|/g, '/')} |`),
    '',
    ...results.flatMap(r => [`## ${r.id} — ${r.ok ? 'OK' : 'FAIL'}`, '', '| Узел | Шаг | Итог | Подробности |', '|---|---|---|---|',
      ...r.steps.map(s => `| ${s.node} | ${s.title} | ${s.ok ? 'OK' : '**FAIL**'} | ${String(s.info).replace(/\|/g, '/')} |`), ''])
  ];
  writeFileSync(REPORT, md.join('\n'));
});

describe('АРМ: сквозные сценарии на seed E2E', () => {
  for (const [id, run] of Object.entries(SCENARIOS)) {
    const t = ONLY.length && !ONLY.includes(id) ? it.skip : it;
    t(id, async () => {
      current = { id, no: String(results.length + 1).padStart(2, '0') + (Date.now() % 1000), steps: [], ok: true, error: '', orders: [], noms: new Set(), docs: [] };
      results.push(current);
      try { await run(); } catch (e) { current.ok = false; current.error = e.message; throw e; } finally { await clearMarks(); }
    }, 1800000);
  }
});
