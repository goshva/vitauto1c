// Пресеты колонок PWA по этапам процессов process.html: узел схемы → его колонки матрицы.
// Узлы ссылаются и на группы колонок (order_header, fact, …) — здесь они раскрываются в id колонок матрицы.
//   node scripts/gen-process-presets.cjs   (после правки process.html или матрицы)
const fs = require('fs');
const path = require('path');
const { loadDefaultProcesses, loadDefaultAccess } = require('../../api/lib/sources');

const GROUPS = {
  order_header: ['order_date', 'order_internal_number', 'order_client_number', 'customer', 'contract', 'service_type'],
  fact: ['brand_fact', 'model_fact', 'aggregate_fact', 'gosnomer_fact', 'grz_fact', 'vin_fact', 'engine_fact', 'urgency_fact',
    'vehicle_plate_fact', 'territory_fact', 'name_fact', 'article_fact', 'qty_fact', 'unit_fact'],
  nomenclature: ['name', 'article', 'code_aa', 'unit'],
  stock: ['stock_qty', 'reserve_qty', 'ordered_in_transit_qty'],
  receipt: ['receipt_date']
};
// всегда видны рядом с колонками этапа: что за позиция и сколько
const CONTEXT = ['order_client_number', 'name_fact', 'name', 'qty'];

const access = loadDefaultAccess();
const ids = new Set(access.columns.map(c => c.id));
const proc = loadDefaultProcesses();
const ROLE_TITLES = { client: 'Клиент', manager: 'Менеджер', admin: 'Админ', supplier: 'Поставщик', storekeeper: 'Кладовщик', chief_mechanic: 'Гл. механик' };

const expand = cols => [...new Set(cols.flatMap(c => GROUPS[c] || [c]))];
const unknown = new Set();
const nodes = proc.nodes
  .filter(n => n.columns && n.columns.length)
  .map(n => {
    const own = expand(n.columns);
    own.filter(c => !ids.has(c)).forEach(c => unknown.add(c));
    return {
      id: n.id,
      role: n.role,
      roleTitle: ROLE_TITLES[n.role] || n.role,
      title: n.title,
      statuses: n.statuses || [],
      columns: [...new Set([...CONTEXT, ...own])].filter(c => ids.has(c))
    };
  });
if (unknown.size) throw new Error('Колонки узлов не найдены в матрице: ' + [...unknown].join(', '));

const out = path.join(__dirname, '..', 'src', 'lib', 'process-presets.json');
fs.writeFileSync(out, JSON.stringify({ source: 'process.html', groups: GROUPS, context: CONTEXT, nodes }, null, 1) + '\n');
console.log(`${out}: ${nodes.length} этапов`);
