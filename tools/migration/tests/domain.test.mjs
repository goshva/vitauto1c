// Модель предметной области (docs/migration/ddd/domain-model.json): актуальна относительно index.html, process.html,
// матрицы PWA и кода переходов, и внутренне согласована. Шаг 1 порядка разработки (ddd/04-development-process.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../extract-domain.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/migration/ddd/domain-model.json'), 'utf8'));

test('domain-model.json совпадает с источниками (иначе: node tools/migration/extract-domain.mjs)', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(build())), model);
});

test('роли: все дорожки process.html и все роли матрицы', () => {
  const ids = model.roles.map(r => r.id);
  for (const id of ['manager', 'storekeeper', 'chief_mechanic', 'admin', 'supplier', 'client', 'supply']) assert.ok(ids.includes(id), id);
  for (const n of model.nodes) assert.ok(ids.includes(n.role), `${n.id}: роль ${n.role}`);
  for (const r of model.roles) assert.ok(r.onecEnum, `${r.id}: нет значения Арм_РолиИнтерфейса`);
});

test('статусы: 15, у каждого есть значение 1С, порядок матрицы = порядок статусов', () => {
  assert.equal(model.statuses.length, 15);
  assert.deepEqual(model.statusOrder, model.statuses.map(s => s.id));
  for (const s of model.statuses) assert.ok(s.onecEnums.length, s.id);
});

test('матрица: у каждой роли каждая колонка, маска длиной 15 из + c .', () => {
  const cols = model.columns.map(c => c.id).sort();
  for (const [role, rights] of Object.entries(model.matrix.rights)) {
    assert.deepEqual(Object.keys(rights).sort(), cols, role);
    for (const [col, mask] of Object.entries(rights)) assert.match(mask, /^[+c.]{15}$/, `${role}.${col}`);
  }
});

test('колонки: у каждой код, поле 1С и имя в API', () => {
  assert.equal(model.columns.length, 57);
  for (const c of model.columns) { assert.ok(c.code, c.id); assert.ok(c.field, c.id); assert.ok(c.api, c.id); }
});

test('узлы и сценарии: ссылки, статусы и колонки существуют', () => {
  const ids = new Set(model.nodes.map(n => n.id));
  const st = new Set(model.statusOrder);
  const groups = new Set(Object.keys(model.roleProfiles.manager));
  const cols = new Set(model.columns.map(c => c.id));
  assert.equal(model.nodes.length, 45);
  for (const n of model.nodes) {
    for (const x of n.next) assert.ok(ids.has(x.to), `${n.id} -> ${x.to}`);
    for (const s of n.statuses) assert.ok(st.has(s), `${n.id}: ${s}`);
    for (const c of n.cols) assert.ok(cols.has(c) || groups.has(c), `${n.id}: колонка ${c}`);
  }
  for (const s of model.scenarios) for (const step of s.steps) {
    for (const n of step.nodes) assert.ok(ids.has(n), `${s.id}: ${n}`);
    if (step.status) assert.ok(st.has(step.status), `${s.id}: ${step.status}`);
  }
});

test('переходы статусов кода: статусы и роли существуют', () => {
  const st = new Set(model.statusOrder), roles = new Set(model.roles.map(r => r.id));
  for (const t of model.transitions) {
    assert.ok(st.has(t.to), t.to);
    t.from.forEach(f => assert.ok(st.has(f), f));
    t.roles.forEach(r => assert.ok(roles.has(r), r));
  }
});
