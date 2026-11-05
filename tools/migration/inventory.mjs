// Полная инвентаризация базы 1С (план, раздел 8 `inventory`; проверка G0.5).
// Вход: COM-выгрузка onec-inventory.js (объекты метаданных и их таблицы хранения), точные числа строк pg-table-counts.sql
// и карта storage-map.json (правила typed). Выход: docs/migration/inventory.json и inventory.md.
// Каждая непустая таблица PostgreSQL 1С должна оказаться либо в данных объекта (typed / legacy / enum), либо в
// служебных таблицах с объяснением, почему они не переносятся. Неизвестные непустые таблицы — ошибка (код возврата 1).
//   node tools/migration/inventory.mjs <inventory.jsonl> <pg-counts.csv> [storage-map.json] [каталог вывода]
import fs from 'node:fs';
import path from 'node:path';

const [invPath, countsPath, mapPath = 'docs/migration/storage-map.json', outDir = 'docs/migration'] = process.argv.slice(2);
if (!invPath || !countsPath) { console.error('usage: node inventory.mjs <inventory.jsonl> <pg-counts.csv> [storage-map.json] [outDir]'); process.exit(2); }

// назначения таблиц, в которых лежат данные учёта
export const DATA_PURPOSES = new Set(['Основная', 'ТабличнаяЧасть', 'Константа', 'ТочкиМаршрута']);
// служебные назначения: почему не переносятся
const SERVICE_NOTES = {
  РегистрацияИзменений: 'регистрация изменений обмена 1С', РегистрацияИзмененийКонстанты: 'регистрация изменений обмена 1С',
  Итоги: 'итоги регистра: пересчитываются (stock.balance) и сверяются (R5)', Обороты: 'обороты регистра: пересчитываются',
  ИтогиСрезПоследних: 'срез последних: пересчитывается', ИтогиПоСчетам: 'итоги бухгалтерии: остаются в 1С (раздел 14)',
  ИтогиМеждуСчетами: 'итоги бухгалтерии: остаются в 1С (раздел 14)',
  СловарьИзмеренияРегистраНакопления: 'служебная таблица агрегатов', НастройкиХраненияИтоговРегистраНакопления: 'служебная',
  НастройкиХраненияИтоговРегистраСведений: 'служебная', НастройкиХраненияИтоговРегистраБухгалтерии: 'служебная',
  СтатистикаЗапросов: 'служебная таблица агрегатов', СписокАгрегатовРегистровНакопления: 'служебная таблица агрегатов',
  НовыеОбороты: 'служебная таблица агрегатов', НастройкиРежимаАгрегатовРегистровНакопления: 'служебная таблица агрегатов',
  БуферОборотов: 'служебная таблица агрегатов', КодыИзмеренийАгрегатовРегистровНакопления: 'служебная таблица агрегатов',
  ИнициализированныеПредопределенныеДанныеСправочника: 'служебная: признак создания предопределённых',
  ИнициализированныеПредопределенныеДанныеПланаВидовХарактеристик: 'служебная', ИнициализированныеПредопределенныеДанныеПланаСчетов: 'служебная',
  ИсторияРаботыПользователей: 'история навигации пользователей 1С: только в бэкапе',
  ВерсииИсторииДанных: 'история данных 1С: только в бэкапе', ПоследниеВерсииИсторииДанных: 'история данных 1С: только в бэкапе',
  НастройкиСтандартногоИнтерфейсаOData: 'состав публикации OData', ИнформацияОРасширенияхКонфигурации: 'расширения 1С: .cfe в репозитории',
  ИнформацияОРасширенияхКонфигурацииНовоеПоколение: 'расширения 1С: .cfe в репозитории'
};
const SERVICE_DEFAULT = 'служебная таблица платформы: сохраняется в бэкапе базы 1С, в vitauto_app не переносится';
// таблицы платформы, которых нет в структуре хранения конфигурации
const PLATFORM = {
  config: 'конфигурация 1С (сохраняется как .cf)', configsave: 'конфигурация 1С', configcas: 'конфигурация 1С', configcassave: 'конфигурация 1С',
  params: 'параметры информационной базы', files: 'файлы платформы', ibversion: 'версия базы', dbschema: 'схема базы 1С',
  _yearoffset: 'смещение дат', _extensionsinfo: 'расширения 1С', _extensionsinfongs: 'расширения 1С', _extdatasrcprms: 'источники данных',
  v8users: 'пользователи ИБ (выгружаются COM, раздел 7.2 № 7)', depotfiles: 'хранилище', _dbcopies: 'копии базы',
  schemastorage: 'схема базы 1С', _usersworkhistory: 'история навигации пользователей 1С: только в бэкапе',
  _extensionsrestruct: 'реструктуризация расширений', _extensionsrestructngs: 'реструктуризация расширений'
};
// таблицы платформы по шаблону имени
const PLATFORM_PATTERNS = [
  [/^_scheduledjobs[0-9]+$/, 'регламентное задание 1С: заменяется воркером vitauto-api (arm.job), расписание описано в ТЗ'],
  [/settings$/, 'настройки пользователей и форм 1С: в новом интерфейсе не используются, только в бэкапе'],
  [/^_datahistory/, 'история данных 1С: только в бэкапе']
];

const lines = fs.readFileSync(invPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(s => JSON.parse(s));
const errors = lines.filter(l => l.error);
const counts = new Map();
for (const row of fs.readFileSync(countsPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
  const [table, rows, bytes] = row.split(';');
  counts.set(table.toLowerCase(), { rows: Number(rows), bytes: Number(bytes) });
}
const map = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : { tables: [] };
const typedByTable = new Map(map.tables.filter(t => t.rule === 'typed').map(t => [t.table, t]));

const owner = meta => meta.split('.').slice(0, 2).join('.');
const objects = new Map();
for (const o of lines.filter(l => l.object)) objects.set(o.object, { ...o, tables: [], rows: 0, tpRows: 0, bytes: 0 });

const seen = new Set();
const service = [];
for (const s of lines.filter(l => 'meta' in l)) {
  const storage = s.storage.toLowerCase();
  // общие таблицы COM отдаёт без ведущего подчёркивания (CommonSettings -> _commonsettings)
  const key = counts.has(storage) || !counts.has('_' + storage) ? storage : '_' + storage;
  seen.add(key);
  const c = counts.get(key) || { rows: null, bytes: 0 };
  const entry = { table: s.table, storage: key, purpose: s.purpose, rows: c.rows, bytes: c.bytes };
  const o = s.meta ? objects.get(owner(s.meta)) : null;
  if (o && DATA_PURPOSES.has(s.purpose)) {
    o.tables.push(entry);
    if (s.purpose === 'ТабличнаяЧасть') o.tpRows += c.rows || 0; else o.rows += c.rows || 0;
    o.bytes += c.bytes;
  } else if (c.rows) {
    service.push({ ...entry, object: s.meta || null, note: SERVICE_NOTES[s.purpose] || SERVICE_DEFAULT });
  }
}
const platform = [];
const unknown = [];
for (const [table, c] of counts) {
  if (seen.has(table) || !c.rows) continue;
  const note = PLATFORM[table] || (PLATFORM_PATTERNS.find(([re]) => re.test(table)) || [])[1];
  if (note) platform.push({ storage: table, rows: c.rows, bytes: c.bytes, note });
  else unknown.push({ storage: table, rows: c.rows, bytes: c.bytes });
}
const missingInPg = [...seen].filter(t => !counts.has(t));

function ruleOf(o) {
  const typed = o.tables.map(t => typedByTable.get(t.table)).filter(Boolean);
  const nonEmpty = o.rows + o.tpRows > 0;
  if (o.kind === 'Перечисление') return { rule: 'enum', target: 'sys.enum_value' };
  if (o.kind === 'ЖурналДокументов') return { rule: 'skip', target: null, note: 'журнал документов — производный индекс документов, строится заново' };
  if (o.kind === 'Последовательность') return { rule: 'skip', target: null, note: 'последовательность проведения 1С' };
  if (typed.length) return { rule: 'typed', target: [...new Set(typed.map(t => t.target))].join(', ') };
  if (!nonEmpty) return { rule: 'empty', target: null };
  if (o.kind === 'РегистрБухгалтерии' || o.kind === 'ПланСчетов') return { rule: 'legacy', target: 'legacy.object', note: 'бухгалтерия остаётся в 1С (раздел 14)' };
  return { rule: 'legacy', target: 'legacy.object' };
}

const list = [...objects.values()].map(o => ({ ...o, ...ruleOf(o) }));
const byKind = {};
for (const o of list) {
  const k = byKind[o.kind] || (byKind[o.kind] = { objects: 0, nonEmpty: 0, rows: 0, tpRows: 0, typed: 0, legacy: 0, enum: 0, skip: 0 });
  k.objects++;
  if (o.rows + o.tpRows > 0) { k.nonEmpty++; k.rows += o.rows; k.tpRows += o.tpRows; }
  if (o.rule in k) k[o.rule]++;
}
const result = {
  generated: new Date().toISOString(), source: path.basename(invPath), counts: path.basename(countsPath), errors,
  totals: {
    objects: list.length, nonEmpty: list.filter(o => o.rows + o.tpRows > 0).length,
    pgTables: counts.size, pgNonEmpty: [...counts.values()].filter(c => c.rows > 0).length,
    dataRows: list.reduce((s, o) => s + o.rows + o.tpRows, 0)
  },
  byKind,
  // пустые объекты — только имя, вид и правило (полный список метаданных — в исходной выгрузке source/*.jsonl)
  objects: list.map(o => o.rows + o.tpRows > 0
    ? { object: o.object, kind: o.kind, synonym: o.synonym, extension: o.extension, rows: o.rows + o.tpRows, mainRows: o.rows, tpRows: o.tpRows,
        bytes: o.bytes, rule: o.rule, target: o.target, note: o.note || null, tables: o.tables.filter(t => t.rows > 0) }
    : { object: o.object, kind: o.kind, rows: 0, rule: o.rule, target: o.target, note: o.note || null, tables: [] }),
  service, platform, unknown, missingInPg
};
fs.mkdirSync(outDir, { recursive: true });
// одна запись на строку: файл компактный и читается в диффе
const NL = '\n';
const lines1 = arr => '[' + NL + arr.map(x => ' ' + JSON.stringify(x)).join(',' + NL) + NL + ']';
fs.writeFileSync(path.join(outDir, 'inventory.json'), '{' + NL + Object.entries(result).map(([k, v]) =>
  ' ' + JSON.stringify(k) + ': ' + (Array.isArray(v) && v.length && typeof v[0] === 'object' ? lines1(v) : JSON.stringify(v))).join(',' + NL) + NL + '}' + NL);

// --- Markdown ---
const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const md = ['# Инвентаризация базы 1С', '',
  `Сгенерировано \`tools/migration/inventory.mjs\` (${result.generated.slice(0, 10)}) из \`${result.source}\` и \`${result.counts}\`: COM-структура хранения и точный \`COUNT(*)\` каждой таблицы PostgreSQL.`, '',
  `Объектов метаданных: **${fmt(result.totals.objects)}**, с данными: **${fmt(result.totals.nonEmpty)}**, строк данных: **${fmt(result.totals.dataRows)}**. ` +
  `Таблиц PostgreSQL: ${fmt(result.totals.pgTables)}, непустых: ${fmt(result.totals.pgNonEmpty)}. Неизвестных непустых таблиц: **${unknown.length}**.`, '',
  'Правила: **typed** — типизированная таблица + `legacy.object`; **legacy** — только `legacy.object`; **enum** — `sys.enum_value`; **skip** — производные данные, строятся заново; **empty** — данных нет.', '',
  '## По видам объектов', '', '| Вид | Объектов | С данными | Строк (основные) | Строк (табличные части) | typed | legacy | enum | skip |', '|---|---|---|---|---|---|---|---|---|'];
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].rows - a[1].rows)) md.push(`| ${k} | ${v.objects} | ${v.nonEmpty} | ${fmt(v.rows)} | ${fmt(v.tpRows)} | ${v.typed} | ${v.legacy} | ${v.enum} | ${v.skip} |`);
md.push('', '## Объекты с данными (кроме перечислений)', '', '| Объект | Синоним | Строк | В т.ч. ТЧ | Правило | Куда | Таблица 1С |', '|---|---|---|---|---|---|---|');
for (const o of result.objects.filter(o => o.rows > 0 && o.rule !== 'enum').sort((a, b) => b.rows - a.rows)) {
  const main = o.tables.find(t => t.purpose !== 'ТабличнаяЧасть');
  md.push(`| ${o.object}${o.extension ? ' *(расш. ' + o.extension + ')*' : ''} | ${(o.synonym || '').replace(/\|/g, '/')} | ${fmt(o.rows)} | ${fmt(o.tpRows)} | ${o.rule} | ${o.target ? '`' + o.target + '`' : ''}${o.note ? ' — ' + o.note : ''} | \`${main ? main.storage : ''}\` |`);
}
md.push('', '## Служебные непустые таблицы (не переносятся)', '', '| Таблица | Назначение | Объект | Строк | Почему |', '|---|---|---|---|---|');
for (const s of service.sort((a, b) => b.rows - a.rows)) md.push(`| \`${s.storage}\` | ${s.purpose} | ${s.object || '—'} | ${fmt(s.rows)} | ${s.note} |`);
for (const p of platform) md.push(`| \`${p.storage}\` | платформа | — | ${fmt(p.rows)} | ${p.note} |`);
if (unknown.length) { md.push('', '## Неизвестные непустые таблицы — РАЗОБРАТЬ', ''); for (const u of unknown) md.push(`- \`${u.storage}\`: ${u.rows} строк`); }
fs.writeFileSync(path.join(outDir, 'inventory.md'), md.join('\n') + '\n');

console.log(`objects ${result.totals.objects}, nonEmpty ${result.totals.nonEmpty}, rows ${result.totals.dataRows}, pgNonEmpty ${result.totals.pgNonEmpty}, service ${service.length}, platform ${platform.length}, unknown ${unknown.length}, missingInPg ${missingInPg.length}, errors ${errors.length}`);
if (unknown.length) console.log('unknown: ' + unknown.map(u => u.storage).join(', '));
process.exit(errors.length || unknown.length ? 1 : 0);
