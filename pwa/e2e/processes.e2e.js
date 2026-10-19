// Сквозные сценарии PWA через OData по канону матрицы (default-matrix.js + решения D1–D12 + АРМ 2.22):
// права полей — матрица; статус строки — три кнопки АРМ (Резервирование / Ожидаем поступление / Возврат) у менеджера
// и администратора; цепочка снабжения — менеджер, кладовщик, администратор; команды заказа — менеджер и администратор;
// роль «Снабжение» в PWA не используется. Данные — seed E2E (tools/e2e/seed-e2e.ps1): «E2E Покупатель», «E2E Поставщик
// Альфа», «E2E Колодки». Сценарии создают заказы и документы — только тестовая база или зеркало (с бэкапом).
//   ODATA_URL=http://127.0.0.1:8090/mirror/odata/standard.odata npm run e2e      E2E_ONLY=happy,roles — выборочно
// Отчёт: e2e/processes-report.md
import { describe, it, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createBackend } from '../src/odata/backend';
import { basicToken } from '../src/odata/client';
import { localDate } from '../src/lib/date';

const BASE = process.env.ODATA_URL || 'http://127.0.0.1:8090/mirror/odata/standard.odata';
const ONLY = (process.env.E2E_ONLY || '').split(/[,;\s]+/).filter(Boolean);
const REPORT = process.env.E2E_REPORT || new URL('./processes-report.md', import.meta.url);
const LOGINS = { manager: 'arm.manager', storekeeper: 'arm.storekeeper', admin: 'arm.admin', mechanic: 'arm.mechanic' };
const SEED = { customer: 'E2E Покупатель', alpha: 'E2E Поставщик Альфа', general: 'E2E Колодки' };
const T = {};
const D = {};
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
    let next = items.find(l => l.linkKey === m.linkKey && l.operation === m.operation && !l.deleted);
    // сплит заказа (строка ушла в новый заказ с новым ключом связи) после деления/слияния строки по партиям (новый Ид):
    // ищем по артикулу клиента из листа (уникален в сценарии) и номеру заказа клиента — они переносятся со строкой
    if (!next && m.factArticle) {
      const f = `НомерЗаказаКлиента eq '${m.clientOrderNumber}' and АртикулКлиента eq '${m.factArticle}' and ВидОперации eq '${m.operation === 'purchase' ? 'Закупка' : 'Продажа'}' and Удаление eq false`;
      const res = await fetch(encodeURI(`${BASE}/InformationRegister_Арм_ДанныеЗакупокИПродаж?$format=json&$select=ИдентификаторЗаписи,РучнаяПравка&$filter=${f}`), { headers: { Authorization: basicToken(LOGINS.manager, '1') } });
      const recs = res.ok ? (await res.json()).value : [];
      const rec = recs.find(x => m.operation !== 'purchase' || x.РучнаяПравка === m.manual) || recs[0];
      if (rec) next = { id: rec.ИдентификаторЗаписи };
    }
    if (next) { ALIAS[id] = next.id; id = next.id; r = await call('manager', 'GET', '/lines/' + id); }
  }
  if (r.status === 200) META[id] = { linkKey: r.data.linkKey, operation: r.data.operation, order: r.data.customerOrder && r.data.customerOrder.id,
    clientOrderNumber: r.data.clientOrderNumber, factArticle: r.data.factArticle, manual: r.data.manual };
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
  for (const [role, views] of [['manager', ['sales', 'purchases']], ['storekeeper', ['sales', 'purchases']],
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
// смена статуса строк продаж — три кнопки АРМ (D12=A): reserve | awaiting_receipt | return
async function status(role, node, to, ids, expect = to) {
  for (const id of ids) await mark(role, id);
  const r = await call(role, 'POST', '/lines/transition', { to });
  await expectStatus(node, `${role}: статус → ${to}`, ids, expect, r);
}
// ожидаемый отказ: код ошибки
async function refused(role, node, title, method, path, body, code) {
  const r = await call(role, method, path, body);
  check(node, `${role}: ${title} — отказ ${code}`, r.status >= 400 && (r.data.code === code || String(r.status) === String(code)), `${r.status}${problem(r)}`);
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
// цепочка снабжения (форма «Снабжение»): менеджер, кладовщик, администратор
async function supply(role, node, purchaseId, st, expect) {
  await mark(role, purchaseId);
  const r = await call(role, 'POST', '/supply/status', { status: st });
  await expectStatus(node, `${role}: снабжение → ${st}`, [purchaseId], expect, r);
}
async function shipments(node, ids, number) {
  const orders = [...new Set((await Promise.all(ids.map(line))).map(l => l.customerOrder.id))];
  const today = localDate();
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
const CHAIN = [['manager', 'M7', 'paid', 'paid'], ['manager', 'P2', 'in_transit', 'in_transit'], ['storekeeper', 'K1', 'acceptance', 'acceptance'],
  ['storekeeper', 'K2', 'to_stock', 'to_stock'], ['manager', 'M9', 'assembly', 'assembly'], ['storekeeper', 'K3', 'assembled', 'ready_to_ship']];
async function supplyTo(purchaseId, saleId, last) {
  for (const [role, node, st, exp] of CHAIN) {
    await supply(role, node, purchaseId, st, exp);
    if (st === last) break;
  }
  const s = await line(saleId);
  check('—', 'продажа идёт за закупкой', s.status === (await line(purchaseId)).status, s.status);
}

const SCENARIOS = {
  // под закупку: импорт → подбор → «Заказать» → цепочка снабжения → приход → отгрузка → «Документ подписан» → «Возврат»
  async happy() {
    const [s] = await newOrder('manager', 'N1,M1', ['Колодки под закупку']);
    await pick('M2', s, D.general, D.alpha, 1200);
    const p = await buy('M4', s, D.general, D.alpha, 1200);
    await supplyTo(p, s, 'assembled');
    const pl = await line(p);
    check('K3', 'приходная накладная по закупке', !!pl.receipt, pl.receipt ? `${pl.receipt.number}, проведена ${pl.receipt.posted}` : '—');
    if (pl.receipt) current.docs.push('ПриходнаяНакладная ' + pl.receipt.number);
    await shipments('M12', [s], 'ОТГ-' + current.no);
    await job('manager', 'K5', [s], 'shipped');
    const l = await line(s);
    check('K5', 'расходная накладная', !!l.shipmentDoc, l.shipmentDoc ? l.shipmentDoc.number : '—');
    if (l.shipmentDoc) current.docs.push('РасходнаяНакладная ' + l.shipmentDoc.number);
    await patch('manager', 'M15', s, 'ДокументПодписанОригинал', true);
    await status('manager', 'N3', 'return', [s]);
  },
  // три кнопки статусов: обязательные поля, whitelist from → to
  async status_buttons() {
    const [s] = await newOrder('manager', 'N1,M1', ['Колодки — резерв']);
    await pick('M2', s, D.general, D.alpha, 1200);
    const l0 = await line(s);
    if (!l0.plate && !l0.aggregate) {   // лист клиента пишет ГРЗ в К2, «Госномер» (Е4) пуст
      await mark('manager', s);
      await refused('manager', 'M3', '«Резервирование» без госномера и агрегата', 'POST', '/lines/transition', { to: 'reserve' }, 'required');
      await clearMarks();
      await patch('manager', 'M2', s, 'Госномер', 'А001АА77');
    } else check('M3', 'госномер/агрегат уже заполнены — проверка обязательных пропущена', true, l0.plate || l0.aggregate);
    await status('manager', 'M3', 'reserve', [s]);
    await mark('manager', s);
    await refused('manager', 'M3', '«Резервирование» → «Ожидаем поступление»', 'POST', '/lines/transition', { to: 'awaiting_receipt' }, 'transition_denied');
    await clearMarks();
    await status('manager', 'N3', 'return', [s]);
  },
  // права ролей: кладовщик и механик — без смены статуса и команд заказа; «Снабжение» — без входа
  async roles() {
    const [s] = await newOrder('manager', 'N1,M1', ['Колодки — права']);
    await pick('M2', s, D.general, D.alpha, 1200);
    const id = (await line(s)).id;
    for (const role of ['storekeeper', 'mechanic']) {
      await mark(role, s);
      await refused(role, 'D2', 'смена статуса', 'POST', '/lines/transition', { to: 'reserve' }, 'matrix_denied');
      await refused(role, 'M4', '«Заказать»', 'POST', '/sales/jobs', { allowSplit: false }, 'matrix_denied');
      await refused(role, 'M15', '«Вычеркнуть»', 'DELETE', '/lines/' + id, undefined, 'matrix_denied');
      await clearMarks();
    }
    await patch('mechanic', 'G4', s, 'КомментарийКСтроке', 'механик: комментарий');
    await patch('storekeeper', 'K8', s, 'КомментарийКСтроке', 'кладовщик: комментарий');
    const token = basicToken('arm.supply', '1');
    let st = 0;
    try { await createBackend({ baseUrl: BASE, session: { token, user: null } })('POST', '/session', { body: { login: 'arm.supply', password: '1' } }); } catch (e) { st = e.status; }
    check('—', 'arm.supply: вход в PWA запрещён', st === 403, String(st));
    await refused('manager', 'M15', 'очистка «Дата заказа» в «Черновик» / «В работе»', 'PATCH', '/lines/' + id, { field: 'ДатаЗаказа', value: '' }, 'required');
  },
  // матрица в «Заказано»: менеджер не меняет количество закупки (403), администратор — меняет и ведёт цепочку
  async virtual_buy() {
    const [s] = await newOrder('manager', 'N1,M1', ['Колодки — админ']);
    await pick('M2', s, D.general, D.alpha, 1200);
    const p = await buy('M13', s, D.general, D.alpha, 1200);
    await refused('manager', 'M13', 'PATCH Количество в «Заказано»', 'PATCH', '/lines/' + (await line(p)).id, { field: 'Количество', value: 2 }, 'matrix_denied');
    await patch('admin', 'A3', p, 'Количество', 2);
    await supply('admin', 'A3', p, 'paid', 'paid');
  }
};

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
  for (const k of ['customer', 'alpha']) D[k] = await find('counterparties', SEED[k]);
  D.general = await find('nomenclature', SEED.general);
}, 600000);

afterAll(() => {
  const md = [
    '# PWA по канону матрицы — сквозные сценарии через OData',
    '',
    `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, ${BASE}. Покупатель ${D.customer && D.customer.name}, поставщик ${D.alpha && D.alpha.name}.`,
    '',
    '| Сценарий | Итог | Шагов | Заказы | Документы | Ошибка |',
    '|---|---|---|---|---|---|',
    ...results.map(r => `| ${r.id} | ${r.ok ? 'OK' : '**FAIL**'} | ${r.steps.length} | ${r.orders.join(', ')} | ${r.docs.join('; ')} | ${(r.error || '').replace(/\|/g, '/')} |`),
    '',
    ...results.flatMap(r => [`## ${r.id} — ${r.ok ? 'OK' : 'FAIL'}`, '', '| Узел | Шаг | Итог | Подробности |', '|---|---|---|---|',
      ...r.steps.map(s => `| ${s.node} | ${s.title} | ${s.ok ? 'OK' : '**FAIL**'} | ${String(s.info).replace(/\|/g, '/')} |`), ''])
  ];
  writeFileSync(REPORT, md.join('\n'));
});

describe('PWA по канону матрицы', () => {
  for (const [id, run] of Object.entries(SCENARIOS)) {
    const t = ONLY.length && !ONLY.includes(id) ? it.skip : it;
    t(id, async () => {
      current = { id, no: String(results.length + 1).padStart(2, '0') + (Date.now() % 1000), steps: [], ok: true, error: '', orders: [], noms: new Set(), docs: [] };
      results.push(current);
      try { await run(); } catch (e) { current.ok = false; current.error = e.message; throw e; } finally { await clearMarks(); }
    }, 1800000);
  }
});
