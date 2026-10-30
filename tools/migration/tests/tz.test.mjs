// ТЗ и план покрывают модель: все контексты, все узлы процесса, проверки и гейты; цифры инвентаризации в ТЗ = inventory.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const text = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tz = text('docs/migration/TZ.md');
const plan = text('tasks/migration-pg-go-vue.md');
const map = JSON.parse(text('docs/migration/ddd/node-map.json'));
const model = JSON.parse(text('docs/migration/ddd/domain-model.json'));
const inv = JSON.parse(text('docs/migration/inventory.json'));

test('ТЗ: требование на каждый ограниченный контекст', () => {
  for (const c of map.contexts) assert.ok(tz.includes('`' + c.id + '`'), c.id);
});

test('ТЗ: каждый узел process.html назван в требованиях', () => {
  for (const n of model.nodes) assert.match(tz, new RegExp(`(^|[\\s,|(])${n.id}([\\s,|)]|$)`, 'm'), n.id);
});

test('ТЗ: роли, сверка, наборы тестов и гейты', () => {
  for (const r of model.roles) assert.ok(tz.includes('`' + r.id + '`'), r.id);
  for (const id of ['R1', 'R3', 'R4', 'R5', 'R6', 'R7', 'r01', 'r02', 'r03', 'r04', 'r05', 'w01', 'i01', 'x01', 'G0.5', 'G11.3', 'M-*', 'F-*'])
    assert.ok(tz.includes(id), id);
  assert.ok(/OpenAPI 3\.1/.test(tz) && /AsyncAPI/.test(tz) && /Swagger/.test(tz), 'API');
});

test('ТЗ: цифры инвентаризации совпадают с inventory.json', () => {
  const t = inv.totals;
  const by = rule => inv.objects.filter(o => o.rows > 0 && o.rule === rule);
  const sum = a => a.reduce((s, o) => s + o.rows, 0);
  for (const [label, v] of [['объектов метаданных', t.objects], ['объектов с данными', t.nonEmpty], ['строк данных', t.dataRows]])
    assert.match(tz, new RegExp(`${label}[^\\n]*\\| ${v} \\|`, 'i'), label);
  assert.ok(tz.includes(`${t.pgTables} / ${t.pgNonEmpty}`), 'таблицы PostgreSQL');
  assert.ok(tz.includes(`${by('typed').length} объекта, ${sum(by('typed'))} строк`), 'typed');
  assert.ok(tz.includes(`${by('legacy').length} объектов, ${sum(by('legacy'))} строк`), 'legacy');
  assert.ok(tz.includes(`| ${by('enum').length} |`), 'enum');
});

test('план: ссылается на ТЗ, DDD и инвентаризацию; этап 12 и гейт G0.6 описаны', () => {
  for (const s of ['docs/migration/TZ.md', 'docs/migration/ddd/', 'inventory.md', 'G0.6', 'Этап 12'])
    assert.ok(plan.includes(s), s);
});
