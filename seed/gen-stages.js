// Генератор seed/demo-stages.sql из process.html:
// одна строка АРМ на каждую стадию каждого сценария, стадия подписана в наименовании.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'process.html'), 'utf8');

// Балансировка скобок/кавычек: вырезаем литерал массива после «var name = ».
function literal(name) {
  const key = 'var ' + name + ' = ';
  const start = html.indexOf(key);
  if (start < 0) throw new Error('not found: ' + name);
  const from = html.indexOf('[', start + key.length);
  let depth = 0, i = from, inStr = null;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"') { inStr = ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const src = html.slice(from, i);
  // eslint-disable-next-line no-eval
  return (0, eval)('(' + src + ')');
}

const NODES = literal('NODES');
const SCENARIOS = literal('SCENARIOS');
const GROUPS = literal('SCENARIO_GROUPS');
const byId = {};
NODES.forEach((n) => (byId[n.id] = n));

// код API статуса → значение перечисления Арм_СтатусыАРМ
const STATUS = {
  new: 'Черновик',
  in_work: 'ВРаботе',
  partially_ordered: 'ЧастичноЗаказано',
  ordered: 'Заказано',
  paid: 'Оплачено',
  in_transit: 'ТоварВПути',
  awaiting_receipt: 'ОжидаемПоступление',
  acceptance: 'Приходуется',
  to_stock: 'НаСкладе',
  reserve: 'Резервирование',
  assembly: 'Комплектуется',
  ready_to_ship: 'Подготовлено',
  shipped: 'Отгружено',
  return: 'Возврат',
  closed: 'Выполнено',
};

// Стадии закупочного/складского контура — операция «Закупка»
const PURCHASE = new Set(['M4', 'P1', 'M7', 'P2', 'K1', 'K2', 'M8', 'K6', 'M16', 'P3', 'M19', 'A3', 'M13', 'K5', 'K9', 'M17']);

const NOM = [
  ['77777777-7777-7777-7777-777777777701', 'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', 2000, 1200],
  ['77777777-7777-7777-7777-777777777702', 'Фильтр масляный', 'FLT-OIL-001', 500, 250],
  ['77777777-7777-7777-7777-777777777703', 'Колодки тормозные передние', 'BRK-FR-001', 1500, 600],
  ['77777777-7777-7777-7777-777777777704', 'Антифриз G12+ (5л)', 'ANT-G12-5L', 1100, 550],
  ['77777777-7777-7777-7777-777777777705', 'Свеча зажигания', 'SPK-IR-001', 800, 300],
  ['77777777-7777-7777-7777-777777777706', 'Фильтр воздушный', 'FLT-AIR-001', 900, 400],
  ['77777777-7777-7777-7777-777777777707', 'Фильтр салонный', 'FLT-CAB-001', 700, 350],
];
const CARS = ['A123BC777', 'E456OP777', 'K789MH750', 'M321PT799', 'T654AA716'];
const CUSTOMERS = [
  '66666666-6666-6666-6666-666666666601',
  '66666666-6666-6666-6666-666666666602',
  '66666666-6666-6666-6666-666666666603',
];
const SUPPLIERS = [
  '66666666-6666-6666-6666-666666666604',
  '66666666-6666-6666-6666-666666666605',
];
const WH = '44444444-4444-4444-4444-444444444401';
// Заказы покупателя из seed/demo-data.sql (ЗК-001…005). Стадии грузятся после них (full-seed.ps1),
// иначе FK arm.line.customer_order_id не сработает. Закупочные строки заказ покупателя не получают.
const ORDER_BY_SCENARIO = {
  happy: 'a0000000-0000-0000-0000-000000000001',
  stock: 'a0000000-0000-0000-0000-000000000002',
  car_repair_in: 'a0000000-0000-0000-0000-000000000003',
  mixed_order: 'a0000000-0000-0000-0000-000000000004',
  delivery_split: 'a0000000-0000-0000-0000-000000000005',
};
const DEFAULT_ORDER = 'a0000000-0000-0000-0000-000000000001';
const orderFor = (scenarioId) => ORDER_BY_SCENARIO[scenarioId] || DEFAULT_ORDER;
const CELLS = [
  '88888888-8888-8888-8888-888888888801',
  '88888888-8888-8888-8888-888888888802',
  '88888888-8888-8888-8888-888888888803',
  '88888888-8888-8888-8888-888888888804',
];
const GROUP_TITLE = {};
GROUPS.forEach((g) => (GROUP_TITLE[g.id] = g.title));

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const rows = [];
const seen = {};
let n = 0;
SCENARIOS.forEach((sc) => {
  sc.steps.forEach((step, i) => {
    const nodeIds = step.nodes || [step.node];
    nodeIds.forEach((nid) => {
      const node = byId[nid];
      if (!node) throw new Error('unknown node ' + nid);
      const key = sc.id + '/' + nid;
      const dup = seen[key];
      seen[key] = true;
      const stageTitle = node.title.replace(/\s*\n\s*/g, ' ');
      const stage = dup ? nid + ' (повтор)' : nid + ' ' + stageTitle;
      const status = STATUS[step.status] || STATUS[(node.status || [])[0]] || 'Комплектуется';
      const nom = NOM[n % NOM.length];
      const purchase = PURCHASE.has(nid);
      const qty = 1 + (n % 4);
      const suffix = dup ? ':rep' + i : '';
      const onecKey = 'demo:stage:' + sc.id + ':' + nid + suffix;
      const name = nom[1] + ' (' + sc.title + ' / ' + stage + ')';
      const comment = (step.note || '') + ' — стадия ' + stage + ', сценарий «' + sc.title + '» (' + (GROUP_TITLE[sc.group] || sc.group) + ')';
      const day = '2026-11-0' + (1 + (n % 5)) + ' 09:00:00';
      rows.push(
        '  (uuidv7(), ' + q('lk:stage:' + sc.id + ':' + nid + suffix) + ', ' + q(purchase ? 'Закупка' : 'Продажа') + ', ' + q(status) + ', ' +
          (purchase ? 'null, ' + q(SUPPLIERS[n % 2]) : q(CUSTOMERS[n % 3]) + ', ' + q(SUPPLIERS[n % 2])) + ', ' +
          q(nom[0]) + ', ' + qty + ', ' + nom[4].toFixed(2) + ', ' + nom[3].toFixed(2) + ', ' + (nom[3] * 1.5).toFixed(2) + ', 1.5, ' +
          q(name) + ', ' + q(nom[2]) + ', ' + q(String(qty)) + ', ' + q(CARS[n % 5]) + ', ' + q('СТ-' + (100 + n)) + ', ' +
          q(comment) + ', ' + q(day) + ', ' + q(WH) + ', ' + q(CELLS[n % 4]) + ', ' +
          (purchase ? 'true' : 'false') + ', ' + q(onecKey) + ', ' + (i + 1) + ', ' +
          (purchase ? 'null' : q(orderFor(sc.id))) + ')'
      );
      n++;
    });
  });
});

const sql = [
  '-- Автогенератор: seed/gen-stages.js — не править вручную.',
  '-- Перегенерация: node seed/gen-stages.js (после правки process.html).',
  '-- Строка АРМ на КАЖДУЮ стадию каждого сценария process.html;',
  '-- стадия подписана в наименовании позиции (fact_name) в скобках: «товар (сценарий / стадия)».',
  '',
  'insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,',
  '  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order, customer_order_id)',
  'values',
  rows.join(',\n'),
  'on conflict (onec_key) do update set status = excluded.status, fact_name = excluded.fact_name, comment = excluded.comment,',
  '  customer_order_id = excluded.customer_order_id, updated_at = now(), deleted = false;',
  '',
].join('\n');

fs.writeFileSync(path.join(root, 'seed', 'demo-stages.sql'), sql, 'utf8');

// Покрытие: узлы process.html, не вошедшие ни в один сценарий, — отдельный блок «вне сценариев».
const used = new Set();
SCENARIOS.forEach((s) => s.steps.forEach((st) => (st.nodes || [st.node]).forEach((x) => used.add(x))));
const orphans = NODES.filter((nd) => !used.has(nd.id));
const orphanRows = orphans.map((nd, k) => {
  const nom = NOM[k % NOM.length];
  const status = STATUS[(nd.status || [])[0]] || 'Черновик';
  const purchase = PURCHASE.has(nd.id);
  const title = nd.title.replace(/\s*\n\s*/g, ' ');
  return (
    '  (uuidv7(), ' + q('lk:stage:orphan:' + nd.id) + ', ' + q(purchase ? 'Закупка' : 'Продажа') + ', ' + q(status) + ', ' +
    (purchase ? 'null, ' + q(SUPPLIERS[k % 2]) : q(CUSTOMERS[k % 3]) + ', ' + q(SUPPLIERS[k % 2])) + ', ' +
    q(nom[0]) + ', 1, ' + nom[4].toFixed(2) + ', ' + nom[3].toFixed(2) + ', ' + (nom[3] * 1.5).toFixed(2) + ', 1.5, ' +
    q(nom[1] + ' (вне сценариев / ' + nd.id + ' ' + title + ')') + ', ' + q(nom[2]) + ", '1', " + q(CARS[k % 5]) + ', ' + q('СТ-9' + (10 + k)) + ', ' +
    q('Стадия ' + nd.id + ' ' + title + ' — не входит в сценарии плеера') + ', ' + q('2026-11-0' + (1 + (k % 5)) + ' 09:00:00') + ', ' + q(WH) + ', ' + q(CELLS[k % 4]) + ', ' +
    (purchase ? 'true' : 'false') + ', ' + q('demo:stage:orphan:' + nd.id) + ', 1, ' +
    (purchase ? 'null' : q(DEFAULT_ORDER)) + ')'
  );
});
let extra = '';
if (orphanRows.length) {
  extra = [
    '',
    '-- Узлы process.html вне сценариев плеера (A0, A5 и т.п.)',
    'insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,',
    '  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order, customer_order_id)',
    'values',
    orphanRows.join(',\n'),
    'on conflict (onec_key) do update set status = excluded.status, fact_name = excluded.fact_name, comment = excluded.comment,',
    '  customer_order_id = excluded.customer_order_id, updated_at = now(), deleted = false;',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'seed', 'demo-stages.sql'), sql + extra, 'utf8');
}
console.log('строк:', rows.length, '+ вне сценариев:', orphanRows.length, '| сценариев:', SCENARIOS.length, '| узлов:', NODES.length);
