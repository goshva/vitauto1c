// Генератор документов DDD (docs/migration/ddd/generated/*.md) из domain-model.json (извлечено из index.html,
// process.html, матрицы и кода PWA) и node-map.json (ручная часть: контексты, агрегаты, команды, события, тесты).
// Вывод детерминирован (без дат): тест tools/migration/tests/ddd.test.mjs сравнивает файлы с результатом render().
//   node tools/migration/ddd-gen.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DDD_DIR = path.join(ROOT, 'docs/migration/ddd');

export function load() {
  const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  const storage = path.join(ROOT, 'docs/migration/storage-map.json');
  return { model: rd(path.join(DDD_DIR, 'domain-model.json')), map: rd(path.join(DDD_DIR, 'node-map.json')), storage: fs.existsSync(storage) ? rd(storage) : null };
}

const esc = s => String(s ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ');
const HEADER = src => `<!-- Сгенерировано tools/migration/ddd-gen.mjs из ${src}. Не править вручную. -->\n`;

// --- вспомогательные вычисления (экспортируются для тестов) ---------------------------------------------------------
export function allTransitions(model, map) {
  const t = model.transitions.map(x => ({ from: x.from, to: x.to, roles: x.roles, via: `POST /lines/transition {to: ${x.to}} → ${x.onecStatus}`, nodes: (model.uiTransitions.find(u => u.to === x.to) || {}).node?.split(' · ') || [], source: 'код PWA (backend.js TRANSITIONS)' }));
  const a = map.fsmAdditions.map(x => ({ ...x, source: 'node-map.json fsmAdditions' }));
  return [...t, ...a];
}
export function transitionCovers(trs, from, to, role) {
  return trs.some(t => (t.to === to || t.alsoTo === to) && t.from.includes(from) && (!role || t.roles.includes(role) || t.actor === role));
}
// переходы статусов, которые встречаются в сценариях process.html
export function scenarioEdges(model) {
  const role = Object.fromEntries(model.nodes.map(n => [n.id, n.role]));
  const edges = [];
  for (const s of model.scenarios) {
    let prev = null;
    for (const st of s.steps) {
      if (st.status && prev && st.status !== prev) edges.push({ scenario: s.id, from: prev, to: st.status, nodes: st.nodes, role: role[st.nodes[0]] });
      if (st.status) prev = st.status;
    }
  }
  return edges;
}
// колонки узла: id колонки или группа колонок (order_header, fact, stock …)
export function nodeColumns(model, node) {
  const ids = new Set();
  for (const c of node.cols) {
    if (model.columns.some(x => x.id === c)) ids.add(c);
    else model.columns.filter(x => x.group === c || (c === 'nomenclature' && x.group === 'nomenclature')).forEach(x => ids.add(x.id));
  }
  return [...ids];
}
export function rightAt(model, role, colId, status) {
  const mask = (model.matrix.rights[role] || {})[colId];
  const i = model.statusOrder.indexOf(status);
  return mask && i >= 0 ? mask[i] : '.';
}

// --- документы ---------------------------------------------------------------------------------------------------
function glossary({ model, map, storage }) {
  const armLine = storage && storage.tables.find(t => t.target === 'arm.line');
  const colByField = Object.fromEntries((armLine ? armLine.fields : []).map(f => [f.onec, f.column]));
  const md = [HEADER('domain-model.json, node-map.json, storage-map.json'), '# Единый язык (ubiquitous language)', '',
    'Один термин — одно имя во всех слоях: схема процесса и матрица (process.html, index.html) → 1С → REST API → база vitauto_app.', '',
    '## Роли', '', '| id (API, матрица) | Роль | Значение 1С `Арм_РолиИнтерфейса` | Дорожка на схеме процесса |', '|---|---|---|---|'];
  for (const r of model.roles) md.push(`| \`${r.id}\` | ${esc(r.title)} | ${r.onecEnum || '—'} | ${r.lanes.length ? r.lanes.join(', ') : 'нет (роль только матрицы PWA)'} |`);
  md.push('', '## Статусы строки', '', '| № | id | Статус | Значения 1С `Арм_СтатусыАРМ` | Ранний (до прихода) |', '|---|---|---|---|---|');
  model.statuses.forEach((s, i) => md.push(`| ${i + 1} | \`${s.id}\` | ${s.title} | ${s.onecEnums.join(', ')} | ${s.early ? 'да' : ''} |`));
  md.push('', '## Колонки строки (атрибуты агрегата Line)', '', '| Код | id | Колонка | Группа | Поле 1С | API (`Line`) | Столбец `arm.line` | Тип | Пишется |', '|---|---|---|---|---|---|---|---|---|');
  for (const c of model.columns) md.push(`| ${c.code || ''} | \`${c.id}\` | ${esc(c.title)} | ${c.group} | ${c.field || ''} | ${c.api ? '`' + c.api + '`' : ''} | ${colByField[c.field] ? '`' + colByField[c.field] + '`' : (c.field && c.field.startsWith('Номенклатура') ? '`nomenclature_id` → ref.nomenclature' : '')} | ${c.dataType || ''} | ${c.writable ? 'да' : 'нет'} |`);
  md.push('', '## Зоны склада (process.html)', '', '| id | Зона | Описание | Роль | В новой модели |', '|---|---|---|---|---|');
  for (const z of model.zones) md.push(`| ${z.id} | ${esc(z.title)} | ${esc(z.desc)} | ${z.role} | ${['Z3', 'Z4'].includes(z.id) ? 'склад `ref.warehouse` (малый / большой)' : z.id === 'Z0' || z.id === 'Z14' ? 'внешний контрагент-поставщик' : 'зона ячеек `ref.storage_cell.zone`'} |`);
  md.push('', '## Ограниченные контексты', '', '| id | Контекст | Тип | Агрегаты | Описание |', '|---|---|---|---|---|');
  for (const c of map.contexts) md.push(`| \`${c.id}\` | ${c.title} | ${c.type} | ${c.owns.join(', ')} | ${esc(c.description)} |`);
  md.push('', '## Доменные события', '', '| Событие | Смысл | Кто порождает (узлы) |', '|---|---|---|');
  for (const [e, d] of Object.entries(map.events)) {
    const nodes = Object.entries(map.nodes).filter(([, n]) => n.emits.includes(e)).map(([id]) => id);
    md.push(`| \`${e}\` | ${d} | ${nodes.join(', ') || '—'} |`);
  }
  return md.join('\n') + '\n';
}

function rolesMatrix({ model, map }) {
  const trs = allTransitions(model, map);
  const md = [HEADER('domain-model.json (pwa/src/odata/matrix.json, index.html), node-map.json'), '# Роли и матрица прав', '',
    'Маска — символ на статус в порядке: ' + model.statusOrder.map((s, i) => `${i + 1} \`${s}\``).join(', ') + '.',
    'Символы: `+` можно менять, `c` только автор строки, `.` нельзя. Проверка — в агрегате `Line` (инвариант 2), одна функция Go для REST и импорта.', ''];
  for (const r of model.roles) {
    md.push(`## ${r.title} (\`${r.id}\`)`, '');
    const lanes = model.nodes.filter(n => n.role === r.id);
    md.push('**Узлы процесса:** ' + (lanes.length ? lanes.map(n => `${n.id} ${n.title}`).join('; ') : 'нет на схеме; роль канбана снабжения в PWA') + '.', '');
    const mine = trs.filter(t => t.roles.includes(r.id));
    md.push('**Переходы статусов:**', '');
    if (mine.length) { md.push('| Из | В | Как | Узлы |', '|---|---|---|---|'); for (const t of mine) md.push(`| ${t.from.join(', ')} | ${t.to}${t.alsoTo ? ' / ' + t.alsoTo : ''} | ${esc(t.via)} | ${t.nodes.join(', ')} |`); }
    else md.push('нет.');
    const prof = model.roleProfiles[r.id];
    if (prof) md.push('', '**Профиль групп колонок (index.html):** ' + Object.entries(prof).map(([g, v]) => `${g}: ${v.visible ? 'видит' : 'скрыто'}${v.editable !== 'none' ? ', правит' : ''}`).join('; ') + '.');
    md.push('', '| Код | Колонка | Маска | Меняет в статусах | Только автор |', '|---|---|---|---|---|');
    for (const c of model.columns) {
      const mask = model.matrix.rights[r.id][c.id] || '';
      const plus = model.statusOrder.filter((s, i) => mask[i] === '+');
      const author = model.statusOrder.filter((s, i) => mask[i] === 'c');
      md.push(`| ${c.code || ''} | ${esc(c.title)} | \`${mask}\` | ${plus.length === model.statusOrder.length ? 'все' : plus.join(', ')} | ${author.join(', ')} |`);
    }
    md.push('');
  }
  return md.join('\n') + '\n';
}

function fsm({ model, map }) {
  const trs = allTransitions(model, map);
  const md = [HEADER('domain-model.json, node-map.json'), '# Автомат статусов строки', '',
    'Переходы из кода PWA (`backend.js` TRANSITIONS = `Арм_API.ПереходыПроцессов`) и дополнения из `node-map.json` (задания, канбан снабжения, отгрузка, самовывоз). Go-реализация обязана разрешать ровно эти переходы.', '',
    '```mermaid', 'stateDiagram-v2'];
  for (const s of model.statuses) md.push(`  ${s.id}: ${s.title}`);
  md.push('  [*] --> new');
  const seen = new Set();
  for (const t of trs) for (const f of t.from) for (const to of [t.to, t.alsoTo].filter(Boolean)) {
    const k = f + '>' + to; if (seen.has(k)) continue; seen.add(k);
    md.push(`  ${f} --> ${to}: ${t.roles.join(',')}`);
  }
  md.push('  closed --> [*]', '```', '', '| Из | В | Роли | Действующее лицо | Как | Узлы | Источник |', '|---|---|---|---|---|---|---|');
  for (const t of trs) md.push(`| ${t.from.join(', ')} | ${t.to}${t.alsoTo ? ' / ' + t.alsoTo : ''} | ${t.roles.join(', ')} | ${t.actor || ''} | ${esc(t.via)} | ${t.nodes.join(', ')} | ${t.source} |`);
  const gaps = trs.filter(t => t.gap);
  if (gaps.length) {
    md.push('', '## Расхождения схемы и кода (решить до этапа 4)', '');
    for (const t of gaps) md.push(`- ${t.from.join(', ')} → ${t.to}: ${t.gap}.`);
  }
  md.push('', '## Покрытие переходов сценариями process.html', '', '| Сценарий | Из | В | Узел | Роль | Покрыт |', '|---|---|---|---|---|---|');
  for (const e of scenarioEdges(model)) md.push(`| ${e.scenario} | ${e.from} | ${e.to} | ${e.nodes.join(' ∥ ')} | ${e.role} | ${transitionCovers(trs, e.from, e.to, e.role) ? 'да' : '**НЕТ**'} |`);
  md.push('', 'Особые правила: в `closed` строку меняет только `admin` (кроме «Документ подписан оригинал»); строка `locked_background` не меняется никем до конца фонового задания.');
  return md.join('\n') + '\n';
}

function processes({ model, map }) {
  const byId = Object.fromEntries(model.nodes.map(n => [n.id, n]));
  const title = Object.fromEntries(model.roles.map(r => [r.id, r.title]));
  const md = [HEADER('domain-model.json (process.html SCENARIOS, NODES), node-map.json, матрица'), '# Схемы взаимодействия по сценариям', '',
    'Каждый шаг сценария process.html → роль → команда (REST API vitauto-api) → проверка матрицы и автомата статусов → событие → уведомление (WebSocket). ' +
    'В таблице шага — колонки узла, которые роль может менять в статусе шага по матрице.', ''];
  for (const g of model.scenarioGroups) {
    md.push(`## ${g.title}`, '');
    for (const s of model.scenarios.filter(x => x.group === g.id)) {
      md.push(`### ${s.title} (\`${s.id}\`)`, '');
      const roles = [...new Set(s.steps.flatMap(st => st.nodes.map(n => byId[n].role)))];
      md.push('```mermaid', 'sequenceDiagram', '  autonumber');
      for (const r of roles) md.push(`  actor ${r} as ${title[r].replace(/[(),]/g, ' ')}`);
      md.push('  participant api as vitauto-api', '  participant db as PostgreSQL');
      for (const st of s.steps) {
        const par = st.nodes.length > 1;
        if (par) md.push('  par одновременно');
        st.nodes.forEach((id, k) => {
          const n = byId[id], m = map.nodes[id];
          if (k > 0) md.push('  and');
          if (m.api && m.api.startsWith('policy:')) {
            md.push(`  Note over api: ${id} политика ${m.command}: ${m.api.slice(8).split(';')[0].trim()}`);
            for (const to of m.notifies.filter(x => roles.includes(x))) md.push(`  api-->>${to}: уведомление ${id}`);
            return;
          }
          if (m.api) {
            md.push(`  ${n.role}->>api: ${id} ${m.command}`);
            // «;» в mermaid — разделитель операторов, в тексте сообщений не используется
            md.push(`  api->>db: матрица ${n.role} @ ${st.status || '—'} → ${m.emits[0] || 'запись'}`);
          } else md.push(`  Note over ${n.role}: ${id} ${m.command} (вне системы)`);
          for (const to of m.notifies.filter(x => x !== '*' && roles.includes(x))) md.push(`  api-->>${to}: уведомление ${id}`);
        });
        if (par) md.push('  end');
        if (st.status) md.push(`  Note over api: статус → ${st.status}`);
      }
      md.push('```', '', '| № | Узел | Роль | Команда | API | Статус | Может менять (матрица) | События | Тесты |', '|---|---|---|---|---|---|---|---|---|');
      s.steps.forEach((st, i) => st.nodes.forEach(id => {
        const n = byId[id], m = map.nodes[id];
        const cols = nodeColumns(model, n);
        const edit = st.status ? cols.filter(c => rightAt(model, n.role, c, st.status) === '+') : [];
        const author = st.status ? cols.filter(c => rightAt(model, n.role, c, st.status) === 'c') : [];
        const codes = ids => ids.map(c => (model.columns.find(x => x.id === c) || {}).code || c).join(', ');
        const rights = !st.status ? '—' : (edit.length || author.length) ? [edit.length ? codes(edit) : '', author.length ? 'автор: ' + codes(author) : ''].filter(Boolean).join('; ') : 'только чтение';
        md.push(`| ${i + 1} | ${id} ${esc(n.title)} | ${n.role} | ${m.command} | ${esc(m.api || m.manual)} | ${st.status || '—'} | ${rights} | ${m.emits.join(', ')} | ${m.tests.join(', ')} |`);
      }));
      md.push('');
    }
  }
  // шаги-действия (не уведомления и не ручные), где матрица не даёт роли менять ни одной колонки узла
  const seen = new Set();
  const obs = [];
  for (const s of model.scenarios) for (const st of s.steps) for (const id of st.nodes) {
    const n = byId[id], m = map.nodes[id];
    if (!st.status || !m.api || m.api.startsWith('policy:') || seen.has(id + st.status)) continue;
    seen.add(id + st.status);
    const cols = nodeColumns(model, n);
    if (cols.length && !cols.some(c => /[+c]/.test(rightAt(model, n.role, c, st.status))))
      obs.push(`| ${id} ${esc(n.title)} | ${n.role} | ${st.status} | ${cols.map(c => (model.columns.find(x => x.id === c) || {}).code || c).join(', ')} | ${m.command} |`);
  }
  md.push('## Наблюдения: шаги, где матрица не даёт роли менять колонки своего узла', '',
    'Команда узла выполняется сервером (статус, документ), но поля узла роль руками не меняет. Проверить с заказчиком при переносе матрицы (этап 4): это намеренно или пробел матрицы.', '',
    '| Узел | Роль | Статус | Колонки узла | Команда |', '|---|---|---|---|---|', ...obs, '');
  return md.join('\n') + '\n';
}

function nodes({ model, map }) {
  const md = [HEADER('domain-model.json, node-map.json'), '# Трассировка узлов процесса', '',
    'Узел process.html → ограниченный контекст → агрегат → команда → API → события → уведомления → этап плана → тесты. Покрытие 1С — как на схеме (cov).', '',
    '| Узел | Роль | Контекст | Агрегат | Команда | API | События | Уведомляет | 1С | Этап | Тесты |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const n of model.nodes) {
    const m = map.nodes[n.id];
    md.push(`| ${n.id} ${esc(n.title)} | ${n.role} | ${m.context} | ${m.aggregate} | ${m.command} | ${esc(m.api || m.manual)} | ${m.emits.join(', ')} | ${m.notifies.join(', ')} | ${model.coverage[n.cov] || n.cov} | ${m.stage} | ${m.tests.join(', ')} |`);
  }
  return md.join('\n') + '\n';
}

function testCatalog({ model, map }) {
  const trs = allTransitions(model, map);
  const byId = Object.fromEntries(model.nodes.map(n => [n.id, n]));
  const cases = model.roles.length * model.columns.length * model.statusOrder.length;
  const md = [HEADER('domain-model.json, node-map.json'), '# Каталог тестов', '',
    'Тесты пишутся до реализации (раздел «Порядок разработки», docs/migration/ddd/04-development-process.md). Идентификатор теста — в имени Go-теста или e2e-сценария.', '',
    '## T — приёмочные тесты узлов', '', '| Тест | Дано | Когда | Тогда |', '|---|---|---|---|'];
  for (const n of model.nodes) {
    const m = map.nodes[n.id];
    md.push(`| T-${n.id} | роль \`${n.role}\`, строка в статусе ${n.statuses.length ? n.statuses.join(' / ') : '— (вне строки)'} | ${m.api ? '`' + esc(m.api) + '`' : esc(m.manual)} | ${[m.emits.length ? 'события ' + m.emits.join(', ') : '', m.notifies.length ? 'уведомление: ' + m.notifies.join(', ') : '', 'запрещено ролям без права (403 matrix_denied)'].filter(Boolean).join('; ')} |`);
  }
  md.push('', '## S — сквозные сценарии (e2e, две и более сессии)', '', '| Тест | Сценарий | Шаги |', '|---|---|---|');
  for (const s of model.scenarios) md.push(`| S-${s.id} | ${esc(s.title)} | ${s.steps.map(st => st.nodes.join('∥') + (st.status ? '→' + st.status : '')).join(' · ')} |`);
  md.push('', '## M — матрица прав (параметризованные)', '',
    `Для каждой роли × колонки × статуса (${model.roles.length} × ${model.columns.length} × ${model.statusOrder.length} = ${cases} случаев): ` +
    '`PATCH /lines/{id}` разрешён ⇔ символ `+` (или `c` и пользователь — автор строки); иначе 403 `matrix_denied`. Данные — `domain-model.json` → `arm.matrix_column`.', '',
    '| Тест | Роль | Колонок с правом хотя бы в одном статусе | Ячеек `+` | Ячеек `c` |', '|---|---|---|---|---|');
  for (const r of model.roles) {
    const masks = Object.values(model.matrix.rights[r.id]);
    md.push(`| M-${r.id} | ${r.title} | ${masks.filter(m => /[+c]/.test(m)).length} | ${masks.join('').split('+').length - 1} | ${masks.join('').split('c').length - 1} |`);
  }
  md.push('', '## F — автомат статусов', '', '| Тест | Переход | Роли (разрешено) | Проверка |', '|---|---|---|---|');
  trs.forEach((t, i) => md.push(`| F-${String(i + 1).padStart(2, '0')} | ${t.from.join('|')} → ${t.to} | ${t.roles.join(', ')} | разрешено этим ролям; остальным 403; из других статусов 409 |`));
  md.push('', '## R — правила полей (index.html FIELD_RULES)', '', '| Тест | Тип | Правило |', '|---|---|---|');
  model.fieldRules.forEach((r, i) => md.push(`| FR-${i + 1} | ${r.type} | ${esc(r.text)} |`));
  md.push('', '## Прочие наборы (план, разделы 9, 11–15)', '',
    '| Набор | Что проверяет |', '|---|---|',
    '| R1–R9 | сверка миграции |', '| r01–r05 | WebSocket: обновление, конфликт, досылка, принудительная перестройка, права по складам |',
    '| w01–w04 | склады и ячейки, перемещение, размещение при приёмке, доступ к складам |', '| i01–i08 | импорт по видам |', '| x01–x06 | интеграция с бухгалтерией |',
    '| G0–G11 | гейты этапов (`tools/migration/gate.ps1`) |');
  md.push('', `Итого: T ${model.nodes.length}, S ${model.scenarios.length}, M ${cases} случаев в ${model.roles.length} наборах, F ${trs.length}, FR ${model.fieldRules.length}.`);
  void byId;
  return md.join('\n') + '\n';
}

export function render(data = load()) {
  return {
    'generated/glossary.md': glossary(data), 'generated/roles-matrix.md': rolesMatrix(data), 'generated/fsm.md': fsm(data),
    'generated/processes.md': processes(data), 'generated/nodes.md': nodes(data), 'generated/test-catalog.md': testCatalog(data)
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [rel, text] of Object.entries(render())) {
    const f = path.join(DDD_DIR, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    console.log(`${rel}: ${text.split('\n').length} строк`);
  }
}
