// Прогон всех 29 операций arm-pwa.openapi.yaml по HTTP-сервису 1С (АРМ v2.9).
const BASE = process.env.BASE || 'http://127.0.0.1:8090/vitauto/hs/api/arm/v1';
const results = [];  // {op, kind: read|write, ok, status, note}

async function call(method, path, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json; charset=utf-8';
  const t0 = Date.now();
  const opts = { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) };
  let r;
  try { r = await fetch(BASE + path, opts); } catch (e) { r = await fetch(BASE + path, opts); } // keep-alive сокет закрыт Apache
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: r.status, json, headers: r.headers, ms: Date.now() - t0 };
}
function rec(op, kind, r, expect, note = '') {
  const ok = expect.includes(r.status);
  const msg = r.json && r.json.code ? `${r.json.code}: ${r.json.message}` : '';
  results.push({ op, kind, ok, status: r.status, note: note || msg, ms: r.ms });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${kind.padEnd(5)} ${op.padEnd(48)} ${r.status} ${r.ms}ms ${note || msg}`);
  return r;
}
const check = (op, r, cond, what) => { if (!cond) console.log(`     ! ${op}: ${what}`); return cond; };

function fixture(id, status) {
  const fs = require('fs'), cp = require('child_process'), dir = __dirname, tmp = require('os').tmpdir();
  fs.writeFileSync(tmp + '/fx-status.u.js', Buffer.from('\ufeff' + fs.readFileSync(dir + '/fx-status.js', 'utf8'), 'utf16le'));
  cp.execFileSync('C:/Windows/SysWOW64/cscript.exe', ['//nologo', '//E:JScript', tmp + '/fx-status.u.js', tmp + '/fx-status.txt', id, status]);
  return fs.readFileSync(tmp + '/fx-status.txt', 'utf16le').trim();
}

(async () => {
  // --- сессии
  const login = async l => call('POST', '/session', { body: { login: l, password: '1' } });
  let r = rec('POST /session', 'write', await login('arm.manager'), [200]);
  const r0 = r;
  const M = r.json && r.json.token;
  check('POST /session', r, r.json && r.json.role === 'manager' && r.json.screen === 'sales', 'role/screen ' + JSON.stringify(r.json));
  const bad = await call('POST', '/session', { body: { login: 'arm.manager', password: 'нет' } });
  console.log(`     неверный пароль -> ${bad.status}`);
  const S = (await login('arm.supply')).json?.token;
  const K = (await login('arm.storekeeper')).json?.token;
  console.log(`     supply token: ${!!S}, storekeeper token: ${!!K}`);

  rec('GET /session', 'read', await call('GET', '/session', { token: M }), [200]);
  r = rec('GET /matrix', 'read', await call('GET', '/matrix', { token: M }), [200]);
  if (r.status === 200) {
    check('GET /matrix', r, r.json.statuses.length === 15 && r.json.columns.length === 50, `statuses ${r.json.statuses.length}, columns ${r.json.columns.length}`);
    const r304 = await call('GET', '/matrix', { token: M, headers: { 'If-None-Match': r.headers.get('etag') } });
    console.log(`     If-None-Match -> ${r304.status}`);
  }

  // --- справочники
  const cps = rec('GET /directories/counterparties', 'read', await call('GET', '/directories/counterparties', { token: M }), [200]).json || [];
  const customer = cps[0];
  const cts = rec('GET /directories/contracts', 'read', await call('GET', '/directories/contracts?ownerId=' + (customer && customer.id), { token: M }), [200]).json || [];
  r = rec('GET /directories/nomenclature', 'read', await call('GET', '/directories/nomenclature?q=' + encodeURIComponent('а'), { token: M }), [200]);
  const nom = (r.json || [])[0];
  rec('GET /directories/batches', 'read', await call('GET', '/directories/batches?nomenclatureId=' + (nom && nom.id), { token: M }), [200]);
  rec('GET /directories/service-types', 'read', await call('GET', '/directories/service-types', { token: M }), [200]);
  rec('GET /directories/payment-forms', 'read', await call('GET', '/directories/payment-forms', { token: M }), [200]);
  console.log(`     контрагентов ${cps.length}, договоров у «${customer && customer.name}» ${cts.length}, номенклатура «${nom && nom.name}»`);

  // --- строки
  r = rec('GET /lines', 'read', await call('GET', '/lines?view=sales&limit=100', { token: M }), [200]);
  const lines = (r.json && r.json.items) || [];
  console.log(`     строк продаж: ${lines.length}; статусы: ${[...new Set(lines.map(l => l.status))].join(', ')}`);
  for (const l of lines) if (l.marked && l.markedBy === (r0.json && r0.json.userName)) await call('POST', `/lines/${l.id}/mark`, { token: M });
  const anyLine = lines[0];
  rec('GET /lines/{lineId}', 'read', await call('GET', '/lines/' + (anyLine && anyLine.id), { token: M }), [200]);
  const withOrder = lines.find(l => l.customerOrder);
  rec('GET /documents/{kind}/{documentId}', 'read', await call('GET', `/documents/customer_order/${withOrder && withOrder.customerOrder.id}`, { token: M }), [200]);
  const deny = await call('GET', '/lines?view=supply', { token: M });
  console.log(`     manager view=supply -> ${deny.status} ${deny.json && deny.json.code}`);

  // --- новый заказ и строки
  r = rec('POST /sales/customer-orders', 'write', await call('POST', '/sales/customer-orders', { token: M,
    body: { customerId: customer && customer.id, contractId: cts[0] && cts[0].id, clientOrderNumber: 'API-' + Date.now() % 100000, date: new Date().toISOString().slice(0, 10) } }), [201]);
  const order = r.json;
  r = rec('POST /lines', 'write', await call('POST', '/lines', { token: M, body: { view: 'sales', customerOrderId: order && order.id, nomenclatureIds: [nom && nom.id] } }), [201]);
  const newLine = Array.isArray(r.json) ? r.json[0] : undefined;
  r = rec('PATCH /lines/{lineId}', 'write', await call('PATCH', '/lines/' + (newLine && newLine.id), { token: M, body: { field: 'Количество', value: 3 } }), [200]);
  if (r.status === 200) check('PATCH', r, r.json.quantity === 3, 'quantity=' + r.json.quantity);
  for (const [f, v] of [['СебестоимостьЕдиницы', 100], ['Коэффициент', 1.5], ['КомментарийКСтроке', 'через API']]) {
    const p = await call('PATCH', '/lines/' + (newLine && newLine.id), { token: M, body: { field: f, value: v } });
    console.log(`     PATCH ${f}=${v} -> ${p.status} ${p.json && (p.json.code || `costSum=${p.json.costSum} salePrice=${p.json.salePrice} saleSum=${p.json.saleSum}`)}`);
  }
  const ro = await call('PATCH', '/lines/' + (newLine && newLine.id), { token: M, body: { field: 'НоменклатураАртикул', value: 'X' } });
  console.log(`     PATCH артикул -> ${ro.status} ${ro.json && ro.json.code}`);

  r = rec('POST /lines/{lineId}/mark', 'write', await call('POST', `/lines/${newLine && newLine.id}/mark`, { token: M }), [200]);
  if (r.status === 200) check('mark', r, r.json.marked === true, 'marked=' + r.json.marked);
  rec('GET /selection', 'read', await call('GET', '/selection?view=sales', { token: M }), [200]);
  rec('POST /selection', 'write', await call('POST', '/selection', { token: M, body: { view: 'sales', customerOrderId: order && order.id, marked: true } }), [200]);

  // --- В работе (фоновое задание)
  r = rec('POST /sales/jobs', 'write', await call('POST', '/sales/jobs', { token: M, body: { allowSplit: true } }), [202]);
  const job = r.json;
  let jr;
  for (let i = 0; i < 90; i++) {
    jr = await call('GET', '/jobs/' + (job && job.id), { token: M });
    if (jr.status !== 200 || jr.json.state !== 'running') break;
    await new Promise(res => setTimeout(res, 1000));
  }
  rec('GET /jobs/{jobId}', 'read', jr, [200], jr.json && `state=${jr.json.state} ${jr.json.message || ''}`);
  const after = await call('GET', '/lines/' + (newLine && newLine.id), { token: M });
  console.log(`     строка после «В работе»: ${after.json && after.json.status}`);

  // --- Подготовлено: отметить строку «В работе» и попробовать
  const inWork = ((await call('GET', '/lines?view=sales&limit=200', { token: M })).json?.items || []).filter(l => l.status === 'in_work' && !l.deleted);
  for (const l of inWork) if (!l.marked) await call('POST', `/lines/${l.id}/mark`, { token: M });
  rec('POST /sales/prepared', 'write', await call('POST', '/sales/prepared', { token: M }), [200, 409]);

  // --- Провести заказ: строка «Подготовлено» (ready_to_ship)
  const all = (await call('GET', '/lines?view=sales&limit=200', { token: M })).json?.items || [];
  // строка нового заказа -> «Подготовлено» фикстурой (задание «В работе» в v2.8 ломается, см. отчёт), отметить, провести свой заказ
  console.log('     фикстура «Подготовлено»: ' + fixture(newLine.id, 'Подготовлено'));
  const nl = (await call('GET', '/lines/' + newLine.id, { token: M })).json;
  if (nl && !nl.marked) await call('POST', `/lines/${newLine.id}/mark`, { token: M });
  rec('POST /sales/customer-orders/{id}/post', 'write', await call('POST', `/sales/customer-orders/${order && order.id}/post`, { token: M }), [200]);
  const posted = (await call('GET', '/documents/customer_order/' + (order && order.id), { token: M })).json;
  console.log(`     заказ ${posted && posted.number}: posted=${posted && posted.posted}`);

  rec('POST /sales/shipments', 'write', await call('POST', '/sales/shipments', { token: M,
    body: { customerOrderId: order && order.id, shipmentDate: new Date().toISOString().slice(0, 10), shipmentNumber: 'ОТГ-1' } }), [200]);
  r = rec('POST /sales/imports', 'write', await call('POST', '/sales/imports', { token: M, body: { customerId: customer && customer.id,
    rows: [{ clientNumber: 'Л-1', urgency: 'срочно', plate: 'А123ВС', territory: 'Склад 1', article: 'ART-1', name: 'Фильтр масляный', quantity: '2' },
           { clientNumber: 'Л-1', article: 'ART-2', name: 'Свеча', quantity: '4' }] } }), [201]);
  const imported = r.json;
  if (imported && imported.id) {
    const il = await call('GET', '/lines?view=sales&customerOrderId=' + imported.id, { token: M });
    console.log(`     строк АРМ у загруженного заказа: ${il.json && il.json.items && il.json.items.length}`);
  }
  rec('POST /sales/supplier-orders', 'write', await call('POST', '/sales/supplier-orders', { token: M, body: {} }), [200, 201]);

  // вычеркнуть строку-черновик: новая строка в загруженном заказе
  const imLines = imported && imported.id ? ((await call('GET', '/lines?view=sales&customerOrderId=' + imported.id, { token: M })).json?.items || []) : [];
  rec('DELETE /lines/{lineId}', 'write', await call('DELETE', '/lines/' + (imLines[0] ? imLines[0].id : newLine && newLine.id), { token: M }), [204]);
  rec('DELETE /sales/customer-orders/{id}', 'write', await call('DELETE', '/sales/customer-orders/' + (imported && imported.id), { token: M }), [204]);

  // --- снабжение: закупка к строке продажи (POST /lines view=purchases), фикстурой — «Заказано»
  const src = all.find(l => l.status === 'in_work' && !l.deleted) || all[0];
  const pl = await call('POST', '/lines', { token: M, body: { view: 'purchases', sourceLineId: src && src.id, nomenclatureIds: [nom && nom.id] } });
  console.log(`     manager POST /lines view=purchases -> ${pl.status} ${pl.json && pl.json.code || ''}`);
  if (pl.status === 201) console.log('     фикстура «Заказано»: ' + fixture(pl.json[0].id, 'Заказано'));

  r = await call('GET', '/lines?view=supply&limit=200', { token: S });
  const NEXT = { ordered: 'paid', paid: 'in_transit', in_transit: 'acceptance', acceptance: 'to_stock', to_stock: 'assembly', assembly: 'assembled' };
  const purch = ((r.json && r.json.items) || []).filter(l => l.operation === 'purchase' && !l.deleted);
  console.log(`     supply: GET view=supply -> ${r.status}, закупок: ${purch.length} (${purch.map(l => l.status).join(', ')})`);
  const sup = purch.find(l => NEXT[l.status] && NEXT[l.status] !== 'assembled');
  if (sup && !sup.marked) await call('POST', `/lines/${sup.id}/mark`, { token: S });
  const target = sup ? NEXT[sup.status] : 'paid';
  r = rec('POST /supply/status', 'write', await call('POST', '/supply/status', { token: S, body: { status: target } }), [200]);
  if (sup) { const a = await call('GET', '/lines/' + sup.id, { token: S }); console.log(`     закупка ${sup.status} -> ${target}: теперь ${a.json && a.json.status}`); }

  rec('DELETE /session', 'write', await call('DELETE', '/session', { token: M }), [204]);
  const gone = await call('GET', '/session', { token: M });
  console.log(`     после выхода GET /session -> ${gone.status}`);

  const sum = k => { const x = results.filter(r => r.kind === k); return `${x.filter(r => r.ok).length} из ${x.length}`; };
  console.log(`\nЧтение: ${sum('read')}; запись: ${sum('write')}`);
  require('fs').writeFileSync(require('os').tmpdir() + '/arm-api-1c-result.json', JSON.stringify(results, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
