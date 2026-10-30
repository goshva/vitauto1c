// DDD: каждый узел процесса сопоставлен (контекст, агрегат, команда, API, события, тесты), автомат статусов покрывает
// все переходы сценариев, сгенерированные документы актуальны. Шаги 2–3 порядка разработки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load, render, DDD_DIR, allTransitions, scenarioEdges, transitionCovers } from '../ddd-gen.mjs';

const data = load();
const { model, map } = data;
const roles = new Set(model.roles.map(r => r.id));
const contexts = new Set(map.contexts.map(c => c.id));
const aggregates = new Set(map.aggregates.map(a => a.id));
const events = new Set(Object.keys(map.events));
const scenarios = new Set(model.scenarios.map(s => s.id));

test('каждый узел process.html сопоставлен, лишних нет', () => {
  assert.deepEqual(Object.keys(map.nodes).sort(), model.nodes.map(n => n.id).sort());
});

test('сопоставление узла полное и ссылается на существующее', () => {
  for (const [id, m] of Object.entries(map.nodes)) {
    assert.ok(contexts.has(m.context), `${id}: контекст ${m.context}`);
    assert.ok(aggregates.has(m.aggregate), `${id}: агрегат ${m.aggregate}`);
    assert.match(m.command, /^[A-Z][A-Za-z]+$/, `${id}: команда`);
    assert.ok(m.api || m.manual, `${id}: нет API и нет объяснения manual`);
    for (const e of m.emits) assert.ok(events.has(e), `${id}: событие ${e} не объявлено`);
    for (const r of m.notifies) assert.ok(r === '*' || roles.has(r), `${id}: роль ${r}`);
    assert.ok(Number.isInteger(m.stage) && m.stage >= 0 && m.stage <= 12, `${id}: этап`);
    assert.ok(m.tests.includes(`T-${id}`), `${id}: нет приёмочного теста T-${id}`);
    for (const t of m.tests.filter(t => t.startsWith('S-'))) assert.ok(scenarios.has(t.slice(2)), `${id}: сценарий ${t}`);
  }
});

test('каждый сценарий привязан хотя бы к одному узлу', () => {
  const used = new Set(Object.values(map.nodes).flatMap(m => m.tests.filter(t => t.startsWith('S-')).map(t => t.slice(2))));
  for (const s of scenarios) assert.ok(used.has(s), s);
});

test('контексты и агрегаты согласованы, события агрегатов объявлены', () => {
  for (const c of map.contexts) for (const a of c.owns) assert.ok(aggregates.has(a), `${c.id}: ${a}`);
  for (const a of map.aggregates) {
    assert.ok(contexts.has(a.context), `${a.id}: ${a.context}`);
    assert.ok(a.invariants.length || !a.root, `${a.id}: у корня агрегата нет инвариантов`);
    for (const e of a.events) assert.ok(events.has(e), `${a.id}: ${e}`);
  }
  for (const r of map.contextMap) for (const c of [r.from, r.to]) assert.ok(c === '*' || contexts.has(c), c);
});

test('автомат статусов покрывает все переходы сценариев process.html', () => {
  const trs = allTransitions(model, map);
  const st = new Set(model.statusOrder);
  for (const t of map.fsmAdditions) {
    assert.ok(st.has(t.to), t.to); t.from.forEach(f => assert.ok(st.has(f), f));
    t.roles.forEach(r => assert.ok(roles.has(r), r));
  }
  const gaps = scenarioEdges(model).filter(e => !transitionCovers(trs, e.from, e.to, e.role));
  assert.deepEqual(gaps, [], 'непокрытые переходы — добавить в node-map.json fsmAdditions');
});

test('generated/*.md совпадают с генератором (иначе: node tools/migration/ddd-gen.mjs)', () => {
  for (const [rel, text] of Object.entries(render(data))) {
    const f = path.join(DDD_DIR, rel);
    assert.ok(fs.existsSync(f), rel);
    assert.equal(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), text, rel);
  }
});

test('в документах есть каждая роль, сценарий и узел', () => {
  const out = render(data);
  for (const r of model.roles) assert.ok(out['generated/roles-matrix.md'].includes(`(\`${r.id}\`)`), r.id);
  for (const s of model.scenarios) assert.ok(out['generated/processes.md'].includes(`(\`${s.id}\`)`), s.id);
  for (const n of model.nodes) assert.ok(out['generated/nodes.md'].includes(`| ${n.id} `), n.id);
  for (const n of model.nodes) assert.ok(out['generated/test-catalog.md'].includes(`| T-${n.id} |`), n.id);
});

test('mermaid-схемы: без «;» в тексте, блоки par закрыты', () => {
  for (const [rel, text] of Object.entries(render(data))) {
    for (const block of text.match(/```mermaid\n[\s\S]*?```/g) || []) {
      assert.ok(!block.includes(';'), `${rel}: «;» внутри mermaid`);
      const opened = (block.match(/^\s+par /gm) || []).length, closed = (block.match(/^\s+end$/gm) || []).length;
      assert.equal(opened, closed, `${rel}: par/end`);
    }
  }
});

test('ручные документы DDD на месте', () => {
  for (const f of ['README.md', '01-strategic.md', '02-tactical.md', '03-interaction.md', '04-development-process.md'])
    assert.ok(fs.statSync(path.join(DDD_DIR, f)).size > 1000, f);
});
