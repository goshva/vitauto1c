// Модель предметной области для DDD миграции (docs/migration/ddd): роли, статусы, колонки, матрица прав,
// правила полей, переходы статусов, узлы процесса, зоны склада и сценарии — из тех же источников, что видит заказчик:
//   index.html     — конфигуратор матрицы (роли, статусы, колонки, правила полей, ролевые профили);
//   process.html   — интерактивный процесс (узлы по ролям, связи, зоны, сценарии);
//   pwa/src/odata/matrix.json — матрица прав, по которой работает PWA (символ на статус: + можно, c автор, . нельзя);
//   pwa/src/odata/backend.js и views/LinesView.vue — переходы статусов по ролям;
//   column-codes.js — коды колонок (А1, Е4 …).
// Литералы берутся из исходного текста и вычисляются в песочнице vm, без выполнения страниц.
//   node tools/migration/extract-domain.mjs [выход=docs/migration/ddd/domain-model.json]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Текст выражения после «<decl> NAME =» до «;» на нулевой глубине скобок (строки, шаблоны и комментарии учитываются).
export function literalText(src, name, decl = 'var') {
  const m = new RegExp(`(?:^|\\n)\\s*${decl}\\s+${name}\\s*=`).exec(src);
  if (!m) throw new Error(`не найдено: ${decl} ${name}`);
  let i = m.index + m[0].length, depth = 0, quote = null;
  const start = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ';' && depth === 0) return src.slice(start, i).trim();
  }
  throw new Error(`нет конца выражения: ${name}`);
}

function evaluate(src, names, decl = 'var', seed = {}) {
  const ctx = vm.createContext({ ...seed });
  for (const n of names) ctx[n] = vm.runInContext(`(${literalText(src, n, decl)})`, ctx);
  return Object.fromEntries(names.map(n => [n, ctx[n]]));
}

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

export function build() {
  const files = {
    index: read('index.html'), process: read('process.html'), matrix: read('pwa/src/odata/matrix.json'),
    backend: read('pwa/src/odata/backend.js'), lines: read('pwa/src/views/LinesView.vue'), codes: read('column-codes.js'),
    mapping: read('pwa/src/odata/mapping.js')
  };
  const idx = evaluate(files.index, ['ROLES', 'STATUSES', 'COLUMNS', 'DIRECTORIES', 'VEHICLE_FILL', 'NOMENCLATURE_KEYS', 'FIELD_RULES', 'EARLY_STATUSES', 'ROLE_PROFILES']);
  idx.ROLE_PROFILES.chief_mechanic = idx.ROLE_PROFILES.manager; // как в index.html: механик = менеджер
  const proc = evaluate(files.process, ['COV', 'ROLES', 'NODES', 'ZONES', 'SCENARIO_GROUPS', 'SCENARIOS', 'STATUS_TITLE', 'COL_TITLE']);
  const be = evaluate(files.backend, ['TRANSITIONS', 'SUPPLY_STATUS', 'ROLE_BY_ENUM'], 'const');
  const ui = evaluate(files.lines, ['TRANSITIONS'], 'const');
  const win = {};
  vm.runInNewContext(files.codes, { window: win });
  const matrix = JSON.parse(files.matrix);

  // поле 1С -> имя в REST API PWA (toLine: «apiName: rec.Поле» и named(rec, 'Поле'))
  const apiByField = {};
  for (const m of files.mapping.matchAll(/(\w+): (?:rec\.(\p{L}[\p{L}\d_]*)|named\(rec, '(\p{L}+)'\)|docRef\(rec, '(\p{L}+)'\)|day\(rec\.(\p{L}+)\))/gu))
    apiByField[m[2] || m[3] || m[4] || m[5]] = m[1];
  // поля, которые toLine собирает выражением (!!rec.X, statusOf, вложенный объект nomenclature, расчёт суммы)
  Object.assign(apiByField, { ОтметкаСтроки: 'marked', ДокументПодписанОригинал: 'signedOriginal', СтатусСтроки: 'status',
    Номенклатура: 'nomenclature', НоменклатураАртикул: 'nomenclature.article', НоменклатураАС_КодАвтоАльянс: 'nomenclature.code',
    НоменклатураЕдиницаИзмерения: 'nomenclature.unit', Сумма: 'saleSum' });

  const matrixCols = new Map(matrix.roles.manager.map(c => [c.id, c]));
  const columns = idx.COLUMNS.map(c => {
    const mc = matrixCols.get(c.id) || {};
    const code = win.VITAUTO_COLUMN_CODES && win.VITAUTO_COLUMN_CODES[c.id];
    return { id: c.id, title: c.title, group: c.group, code: mc.code || (code && code.code) || null, field: mc.field || null,
      api: mc.field ? apiByField[mc.field] || null : null, dataType: mc.dataType || c.type || null, writable: mc.writable ?? null };
  });
  const roleTitles = Object.fromEntries([...proc.ROLES, ...idx.ROLES].map(r => [r.id, r.title.replace(/\s*\n\s*/g, ' ')]));
  roleTitles.supply = roleTitles.supply || 'Снабжение';
  const roles = Object.keys(matrix.roles).map(id => ({
    id, title: roleTitles[id] || id, onecEnum: Object.entries(be.ROLE_BY_ENUM).find(([, r]) => r === id)?.[0] || null,
    inProcess: proc.ROLES.some(r => r.id === id), lanes: proc.NODES.filter(n => n.role === id).map(n => n.id)
  }));
  const statuses = idx.STATUSES.map(s => ({ id: s.id, title: s.title, onecEnums: matrix.statusEnum[s.id] || [], early: idx.EARLY_STATUSES.includes(s.id) }));
  const rights = Object.fromEntries(Object.entries(matrix.roles).map(([role, cols]) => [role, Object.fromEntries(cols.map(c => [c.id, c.rights]))]));

  return {
    schema: 1,
    sources: Object.fromEntries(Object.entries({ 'index.html': files.index, 'process.html': files.process, 'pwa/src/odata/matrix.json': files.matrix,
      'pwa/src/odata/backend.js': files.backend, 'pwa/src/views/LinesView.vue': files.lines, 'column-codes.js': files.codes, 'pwa/src/odata/mapping.js': files.mapping })
      .map(([k, v]) => [k, sha(v)])),
    roles, statuses,
    statusOrder: matrix.statuses,
    columnGroups: (win.VITAUTO_COLUMN_GROUPS || []).map(g => ({ code: g.code, letter: g.letter, title: g.title, parent: g.parent || null, columns: g.columns })),
    columns,
    fieldRules: idx.FIELD_RULES.map(r => ({ ...r, values: r.values ? [...r.values] : undefined })),
    roleProfiles: idx.ROLE_PROFILES,
    matrix: { legend: { '+': 'можно менять', c: 'только автор строки', '.': 'нельзя' }, rights },
    transitions: be.TRANSITIONS.map(t => ({ to: t.to, onecStatus: t.status, from: t.from, roles: t.roles })),
    uiTransitions: ui.TRANSITIONS,
    supplyStatus: be.SUPPLY_STATUS,
    coverage: proc.COV,
    nodes: proc.NODES.map(n => ({ id: n.id, role: n.role, title: n.title, full: n.full, cov: n.cov, statuses: n.status || [], cols: n.cols || [],
      next: (n.next || []).map(x => ({ to: x.to, label: x.label || '', dashed: !!x.dashed })), tz: n.tz || '', code: n.code || '', conflict: n.conflict || '' })),
    zones: proc.ZONES,
    scenarioGroups: proc.SCENARIO_GROUPS,
    scenarios: proc.SCENARIOS.map(s => ({ id: s.id, group: s.group, title: s.title,
      steps: s.steps.map(st => ({ nodes: st.nodes || [st.node], note: st.note, status: st.status ?? null })) })),
    colTitles: proc.COL_TITLE
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || path.join(ROOT, 'docs/migration/ddd/domain-model.json');
  const model = build();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(model, null, 1) + '\n');
  console.log(`roles ${model.roles.length}, statuses ${model.statuses.length}, columns ${model.columns.length}, rules ${model.fieldRules.length}, ` +
    `transitions ${model.transitions.length}, nodes ${model.nodes.length}, zones ${model.zones.length}, scenarios ${model.scenarios.length}`);
}
