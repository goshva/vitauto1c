// Сквозные прогоны всех 11 сценариев process.html только запросами REST API АРМ (v2.9).
// Каждый сценарий — новый заказ из листа клиента; шаги подписаны узлами схемы, у шага проверяется итоговый статус.
// Пишет данные — только тестовая база. Пользователи (пароль 1): arm.manager, arm.storekeeper, arm.supply, arm.admin,
// arm.mechanic (tools/arm-api-1c/prod-setup.js).
//   node tools/arm-api-1c/e2e-processes.js [базовый URL API] [id сценария ...]
const args = process.argv.slice(2);
const BASE = args[0] && args[0].startsWith('http') ? args.shift() : 'http://127.0.0.1:8090/vitauto/hs/api/arm/v1';
const ONLY = args;
const LOGINS = { manager: 'arm.manager', storekeeper: 'arm.storekeeper', supply: 'arm.supply', admin: 'arm.admin', mechanic: 'arm.mechanic' };
const T = {}; // роль → { token, userName }
const results = [];
let current; // текущий сценарий

async function call(role, method, path, body) {
  const h = { Accept: 'application/json' };
  if (role) h.Authorization = 'Bearer ' + T[role].token;
  if (body !== undefined) h['Content-Type'] = 'application/json; charset=utf-8';
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  return { status: r.status, data };
}
const problem = r => (r.data && r.data.code ? ` ${r.data.code}: ${r.data.message}` : '');
function check(node, title, ok, info = '') {
  current.steps.push({ node, title, ok });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${node.padEnd(7)} ${title.padEnd(50)} ${info}`);
  if (!ok) throw new Error(`${node}: ${title} — ${info}`);
}
// Строка по id. После прихода АРМ пересобирает строки заказа по партиям (ПолучитьОстаткиПоСтрокам) — id меняются,
// ключ связи и вид операции остаются: строку находим заново в том же заказе и дальше идём по новому id.
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
// снять отметку чужого автора и отметить строку ролью
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
  await expectStatus(node, `${role}: POST /lines/transition ${view} → ${to}`, ids, expect, r);
}
async function job(role, node, ids, expect) {
  for (const id of ids) await mark(role, id);
  const r = await call(role, 'POST', '/sales/jobs', { allowSplit: true });
  let j = r.data;
  for (let i = 0; i < 60 && j && j.state === 'running'; i++) { await new Promise(res => setTimeout(res, 1000)); j = (await call(role, 'GET', '/jobs/' + j.id)).data; }
  const st = [];
  for (const id of ids) st.push((await line(id)).status);
  check(node, `${role}: POST /sales/jobs «В работе»`, j && j.state === 'done' && st.every(s => s === expect),
    `job ${j && j.state}${j && j.state !== 'done' ? ' ' + (j.message || '').replace(/\s+/g, ' ').slice(0, 220) : ''} → ${st.join(', ')}`);
}
async function supply(node, purchaseId, status, expect) {
  await mark('supply', purchaseId);
  const r = await call('supply', 'POST', '/supply/status', { status });
  await expectStatus(node, `supply: POST /supply/status ${status}`, [purchaseId], expect, r);
}
async function shipments(node, ids, number) {
  const orders = [...new Set((await Promise.all(ids.map(line))).map(l => l.customerOrder.id))];
  const today = new Date().toISOString().slice(0, 10);
  for (const o of orders) {
    const r = await call('manager', 'POST', '/sales/shipments', { customerOrderId: o, shipmentDate: today, shipmentNumber: number });
    check(node, 'manager: POST /sales/shipments', r.status === 200 && r.data.processed > 0, `${r.status}${problem(r)} обработано ${r.data && r.data.processed}`);
  }
  for (const id of ids) { const l = await line(id); check(node, 'дата и номер отгрузки в строке', l.shipmentNumber === number && !!l.shipmentDate, `${l.shipmentDate} ${l.shipmentNumber}`); }
}
const none = (node, title) => check(node, title + ' (без изменения данных)', true);

// ---------------------------------------------------------------- данные сценария
let NOM, CUSTOMER, SUPPLIER;
async function newOrder(role, node, names) {
  const r = await call(role, 'POST', '/sales/imports', { customerId: CUSTOMER.id,
    rows: names.map((n, i) => ({ clientNumber: `${current.id}-${Date.now() % 100000}`, urgency: 'срочно', plate: 'А001АА77',
      territory: 'Склад 1', article: `${current.id}-${i + 1}`, name: n, quantity: '1' })) });
  check(node, `${role}: POST /sales/imports`, r.status === 201, `${r.status}${problem(r)} ${r.data && r.data.number || ''}`);
  const items = (await call('manager', 'GET', `/lines?view=sales&customerOrderId=${r.data.id}`)).data.items;
  check(node, 'строки заказа в АРМ', items.length === names.length, `строк ${items.length}`);
  return items.map(l => l.id);
}
async function pick(node, id) {
  await patch('manager', node, id, 'Номенклатура', NOM.id);
  await patch('manager', node, id, 'Количество', 1);
  await patch('manager', node, id, 'СебестоимостьЕдиницы', 500);
  await patch('manager', node, id, 'Коэффициент', 1.3);
  await patch('manager', node, id, 'Поставщик', SUPPLIER.id);
}
async function buy(node, saleId) {
  const r = await call('manager', 'POST', '/lines', { view: 'purchases', sourceLineId: (await line(saleId)).id, nomenclatureIds: [NOM.id] });
  check(node, 'manager: POST /lines view=purchases', r.status === 201, String(r.status) + problem(r));
  const id = r.data[0].id;
  for (const [f, v] of [['Количество', 1], ['Поставщик', SUPPLIER.id], ['СебестоимостьЕдиницы', 500], ['Цена', 500]]) await patch('manager', node, id, f, v);
  await job('manager', node, [id], 'ordered');
  return id;
}
// закупка до статуса цепочки снабжения; продажа идёт вместе с ней
const CHAIN = [['M7', 'paid', 'paid'], ['P2', 'in_transit', 'in_transit'], ['K1', 'acceptance', 'acceptance'], ['K2', 'to_stock', 'to_stock'],
  ['M9', 'assembly', 'assembly'], ['K3', 'assembled', 'ready_to_ship']];
async function supplyTo(purchaseId, saleId, last) {
  for (const [node, st, exp] of CHAIN) {
    await supply(node, purchaseId, st, exp);
    if (node === 'M7') none('P1', 'поставщик обработал заказ');
    if (node === 'K2') none('M8', 'уведомление о приходе');
    if (st === last) break;
  }
  const s = await line(saleId);
  check('—', 'продажа идёт за закупкой', s.status === (await line(purchaseId)).status, s.status);
}
async function stockToReady(id) {
  await transition('manager', 'M3', 'sales', 'reserve', [id]);
  await transition('manager', 'M9', 'sales', 'assembly', [id]);
  await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [id]);
  none('M11', 'уведомление о готовности');
}
async function shipAndClose(ids) {
  await shipments('M12', ids, 'ОТГ-' + current.no);
  await job('manager', 'K5', ids, 'shipped');
  for (const id of ids) { const l = await line(id); check('K5', 'расходная накладная', !!l.shipmentDoc, l.shipmentDoc ? l.shipmentDoc.number : '—'); }
  none('N2a', 'клиент получил товар');
  for (const id of ids) await patch('manager', 'M15', id, 'ДокументПодписанОригинал', true);
  await transition('manager', 'M15,K7', 'sales', 'closed', ids);
}
// Предусловие «товар есть на складе» (включён контроль остатков при проведении): отдельный заказ проходит
// закупку до прихода (+1 на складе) и закрывается без отгрузки.
async function replenish() {
  console.log('  — пополнение склада (предусловие)');
  const [s] = await newOrder('manager', 'пред.', ['Пополнение склада']);
  await pick('пред.', s);
  const p = await buy('пред.', s);
  await supplyTo(p, s, 'assembled');
  await transition('manager', 'пред.', 'sales', 'closed', [s]);
  console.log('  — сценарий');
}
async function toShipped(id) {
  await pick('M2', id);
  await stockToReady(id);
  await shipments('M12', [id], 'ОТГ-' + current.no);
  await job('manager', 'K5', [id], 'shipped');
}

const SCENARIOS = {
  async happy() {
    const [s] = await newOrder('manager', 'N1,M1', ['Позиция под закупку']);
    await pick('M2', s);
    const p = await buy('M4', s);
    await supplyTo(p, s, 'assembled');
    const pl = await line(p);
    check('K3', 'приходная накладная по закупке', !!pl.receipt, pl.receipt ? `${pl.receipt.number}, проведена ${pl.receipt.posted}` : '—');
    none('M11', 'уведомление о готовности');
    await shipAndClose([s]);
  },
  async stock() {
    await replenish();
    const [s] = await newOrder('manager', 'N1,M1', ['Позиция со склада']);
    await pick('M2', s);
    await stockToReady(s);
    await shipAndClose([s]);
  },
  async mixed_order() {
    await replenish();
    const [a, b] = await newOrder('manager', 'N1,M1', ['Со склада', 'Под закупку']);
    await pick('M2', a);
    await pick('M2', b);
    await transition('manager', 'M3', 'sales', 'reserve', [a]);
    const p = await buy('M4', b);
    await supplyTo(p, b, 'to_stock');
    await transition('manager', 'M9', 'sales', 'assembly', [a]);
    await supply('M9', p, 'assembly', 'assembly');
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [a]);
    await supply('K3', p, 'assembled', 'ready_to_ship');
    none('M11', 'уведомление о готовности');
    await shipAndClose([a, b]);
  },
  async delivery_split() {
    const [s] = await newOrder('manager', 'N1,M1', ['Самовывоз у поставщика']);
    await pick('M2', s);
    const p = await buy('M4', s);
    await supplyTo(p, s, 'paid');
    await transition('manager', 'N4', 'purchases', 'shipped', [p]);
    await expectStatus('N4', 'продажа вместе с закупкой', [s], 'shipped');
    await patch('manager', 'M17', s, 'КомментарийКСтроке', 'Клиент забрал у поставщика');
    await patch('storekeeper', 'K9', s, 'КомментарийКСтроке', 'Самовывоз: документы на приёмку');
    await transition('storekeeper', 'K1', 'purchases', 'acceptance', [p]);
    await expectStatus('K1', 'продажа вместе с закупкой', [s], 'acceptance');
    none('K2', 'размещение');
    none('M8', 'уведомление о приходе');
    await transition('manager', 'M9', 'sales', 'assembly', [s]);
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [s]);
    none('M11', 'уведомление о готовности');
    await shipments('M12', [s], 'ОТГ-' + current.no);
    await transition('manager', 'M15,K7', 'sales', 'closed', [s]);
  },
  async virtual_buy() {
    const [s] = await newOrder('manager', 'N1,M1', ['Срочная позиция без документов']);
    await pick('M2', s);
    const p = await buy('M13', s);
    const r = await call('manager', 'PATCH', '/lines/' + (await line(p)).id, { field: 'Количество', value: 2 });
    check('M13', 'manager: PATCH Количество в «Заказано» → 403', r.status === 403, String(r.status) + problem(r));
    await patch('admin', 'A3', p, 'Количество', 2);
    await mark('admin', p);
    const r2 = await call('admin', 'POST', '/supply/status', { status: 'paid' });
    await expectStatus('A3', 'admin: POST /supply/status paid', [p], 'paid', r2);
  },
  async defect() {
    await replenish();
    const [s] = await newOrder('manager', 'N1,M1', ['Комплектация с отклонением']);
    await pick('M2', s);
    await transition('manager', 'M3', 'sales', 'reserve', [s]);
    await transition('manager', 'M9', 'sales', 'assembly', [s]);
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [s]);
    await patch('manager', 'M10', s, 'КомментарийКСтроке', 'Комплектация отклонена: не та позиция');
    await transition('manager', 'M10', 'sales', 'assembly', [s]);
    await patch('storekeeper', 'K8', s, 'КомментарийКСтроке', 'Розыск позиции');
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [s]);
    none('M11', 'уведомление о готовности');
    await shipAndClose([s]);
  },
  async cancel_supplier() {
    const [s] = await newOrder('manager', 'N1,M1', ['Отмена у поставщика']);
    await pick('M2', s);
    const p = await buy('M4', s);
    await supplyTo(p, s, 'paid');
    await patch('manager', 'M15', p, 'КомментарийКСтроке', 'Документы проверены перед возвратом');
    await transition('manager', 'M16', 'purchases', 'return', [p]);
    await expectStatus('M16', 'продажа вместе с закупкой', [s], 'return');
    none('P3', 'поставщик закрыл заказ');
  },
  async return() {
    await replenish();
    const [s] = await newOrder('manager', 'N1,M1', ['Возврат от клиента']);
    await toShipped(s);
    await transition('manager', 'N3', 'sales', 'return', [s]);
    await patch('storekeeper', 'K6', s, 'КомментарийКСтроке', 'Возврат принят на склад');
    await shipments('M19', [s], 'КОР-' + current.no);
    await patch('manager', 'M16', s, 'КомментарийКСтроке', 'Заявка на возврат поставщику');
    await patch('storekeeper', 'K6', s, 'КомментарийКСтроке', 'Подготовлено к возврату поставщику');
    none('P3', 'поставщик принял возврат');
    await expectStatus('P3', 'строка в «Возврат»', [s], 'return');
  },
  async return_mgr() {
    const [s] = await newOrder('manager', 'N1,M1', ['Возврат поставщику']);
    await pick('M2', s);
    const p = await buy('M4', s);
    await supplyTo(p, s, 'to_stock');
    await transition('manager', 'M16', 'purchases', 'return', [p]);
    await expectStatus('M16', 'продажа вместе с закупкой', [s], 'return');
    await patch('storekeeper', 'K6', p, 'КомментарийКСтроке', 'Передано поставщику');
    none('P3', 'поставщик принял возврат');
    await transition('manager', 'M15,K7', 'purchases', 'closed', [p]);
    await expectStatus('M15,K7', 'продажа вместе с закупкой', [s], 'closed');
  },
  async return_internal() {
    await replenish();
    const [s] = await newOrder('manager', 'N1,M1', ['Отказ при получении']);
    await toShipped(s);
    none('N2a', 'клиент отказался при получении');
    await transition('manager', 'N3', 'sales', 'return', [s]);
    await patch('storekeeper', 'K6', s, 'КомментарийКСтроке', 'Отказ: товар на складе');
    await transition('manager', 'M10', 'sales', 'assembly', [s]);
    none('M9', 'задание на комплектацию');
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [s]);
    none('M11', 'уведомление о готовности');
    await shipments('M12', [s], 'ОТГ2-' + current.no);
    await transition('manager', 'M15,K7', 'sales', 'closed', [s]);
  },
  async car_repair_in() {
    const [a, b] = await newOrder('mechanic', 'N1,G1', ['Запчасть со склада', 'Запчасть под заказ']);
    await pick('M2', a);
    await pick('M2', b);
    await transition('manager', 'M3', 'sales', 'reserve', [a]);
    const p = await buy('M4', b);
    await supplyTo(p, b, 'to_stock');
    await transition('manager', 'M9', 'sales', 'assembly', [a]);
    await supply('M9', p, 'assembly', 'assembly');
    await transition('storekeeper', 'K3', 'sales', 'ready_to_ship', [a]);
    await supply('K3', p, 'assembled', 'ready_to_ship');
    none('M11', 'уведомление о готовности');
    await transition('mechanic', 'G3', 'sales', 'assembly', [a, b]);
    await patch('mechanic', 'G4', a, 'КоличествоНормаЧас', 1.5);
    none('G5', 'зарплатный фонд');
    await transition('mechanic', 'G9', 'sales', 'closed', [a, b]);
  }
};

(async () => {
  for (const [role, login] of Object.entries(LOGINS)) {
    const r = await call(null, 'POST', '/session', { login, password: '1' });
    if (r.status !== 200) throw new Error(`вход ${login}: ${r.status}${problem(r)}`);
    T[role] = { token: r.data.token, userName: r.data.userName };
  }
  await clearMarks();
  const dirs = (await call('manager', 'GET', '/directories/counterparties')).data;
  CUSTOMER = dirs[0];
  SUPPLIER = dirs.find(c => c.id !== CUSTOMER.id) || CUSTOMER;
  NOM = (await call('manager', 'GET', '/directories/nomenclature?q=' + encodeURIComponent('Крышка'))).data[0];
  console.log(`API ${BASE}\nзаказчик ${CUSTOMER.name}, поставщик ${SUPPLIER.name}, номенклатура ${NOM.name}`);

  for (const [id, run] of Object.entries(SCENARIOS)) {
    if (ONLY.length && !ONLY.includes(id)) continue;
    current = { id, no: String(results.length + 1).padStart(2, '0') + (Date.now() % 1000), steps: [], ok: true, error: '' };
    results.push(current);
    console.log(`\n### ${id}`);
    try { await run(); } catch (e) { current.ok = false; current.error = e.message; }
    await clearMarks();
  }
  console.log('\n=== Итог');
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.id.padEnd(16)} шагов ${r.steps.length}${r.ok ? '' : ' — ' + r.error}`);
  const ok = results.filter(r => r.ok).length;
  console.log(`сценариев ${results.length}, пройдено ${ok}`);
  process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
