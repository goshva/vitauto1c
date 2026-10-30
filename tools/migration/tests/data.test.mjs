// Данные: полная инвентаризация (G0.5), карта таблиц (G0.2/G0.4) и правило UUID (G0.3) согласованы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onecUuid, onecIdrref } from '../onec-uuid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rd = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const inv = rd('docs/migration/inventory.json');
const map = rd('docs/migration/storage-map.json');

test('UUID: перевод _IDRRef проверенной записи vitauto_dev и обратно', () => {
  // Справочник.Номенклатура «НФ-00000001»: PostgreSQL _IDRRef и УникальныйИдентификатор() из 1С (гейт G0.3)
  assert.equal(onecUuid('8dd600155d00360911f08fc9dba691ea'), 'dba691ea-8fc9-11f0-8dd6-00155d003609');
  assert.equal(onecIdrref('dba691ea-8fc9-11f0-8dd6-00155d003609'), '8dd600155d00360911f08fc9dba691ea');
  assert.equal(onecUuid('00000000000000000000000000000000'), null);
  assert.equal(map.uuidSample.uuid, 'dba691ea-8fc9-11f0-8dd6-00155d003609');
  assert.throws(() => onecUuid('xyz'));
});

test('инвентаризация: без ошибок и без неизвестных непустых таблиц', () => {
  assert.deepEqual(inv.errors, []);
  assert.deepEqual(inv.unknown, []);
});

test('инвентаризация: у каждого объекта с данными есть правило переноса', () => {
  const bad = inv.objects.filter(o => o.rows > 0 && !['typed', 'legacy', 'enum', 'skip'].includes(o.rule));
  assert.deepEqual(bad.map(o => o.object), []);
  const skip = inv.objects.filter(o => o.rule === 'skip' && o.rows > 0);
  for (const o of skip) assert.ok(o.note, `${o.object}: skip без обоснования`);
  for (const s of [...inv.service, ...inv.platform]) assert.ok(s.note, `${s.storage}: служебная таблица без обоснования`);
});

test('инвентаризация: итоги сходятся', () => {
  const nonEmpty = inv.objects.filter(o => o.rows > 0);
  assert.equal(inv.totals.objects, inv.objects.length);
  assert.equal(inv.totals.nonEmpty, nonEmpty.length);
  assert.equal(inv.totals.dataRows, nonEmpty.reduce((s, o) => s + o.rows, 0));
  // каждая непустая таблица PostgreSQL учтена ровно в одной категории
  const dataTables = inv.objects.flatMap(o => o.tables.filter(t => t.rows > 0).map(t => t.storage));
  const all = [...dataTables, ...inv.service.map(s => s.storage), ...inv.platform.map(p => p.storage)];
  assert.equal(new Set(all).size, all.length, 'таблица учтена дважды');
  assert.equal(all.length, inv.totals.pgNonEmpty);
});

test('карта таблиц: typed-объекты есть в инвентаризации с правилом typed, поля arm.line названы все', () => {
  const byObj = new Map(inv.objects.map(o => [o.object, o]));
  for (const t of map.tables.filter(t => t.rule === 'typed' && t.purpose === 'Основная')) {
    const o = byObj.get(t.table);
    assert.ok(o, t.table);
    assert.equal(o.rule, 'typed', t.table);
  }
  const line = map.tables.find(t => t.target === 'arm.line');
  assert.deepEqual(line.fields.filter(f => !f.column).map(f => f.onec), [], 'поля строки АРМ без столбца');
  assert.equal(line.fields.length, 67);
  for (const t of map.tables.filter(t => t.rule === 'typed')) assert.deepEqual(t.mappedMissing, [], t.table);
});
