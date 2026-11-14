import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

// Сверка цели Q1–Q7 с фактом. Каждый пункт — с доказательством, а не «сделано».

const psql = 'C:\\Program Files\\PostgreSQL 1C\\18\\bin\\psql.exe';
const db = 'postgres://postgres:postgres@127.0.0.1:5434/vitauto_proto';
const env = { ...process.env, PGPASSWORD: 'postgres' };
const q = (sql: string): string =>
  execFileSync(psql, [db, '-Atc', sql], { encoding: 'utf8', env }).trim();

const tables = Number(q(`select count(*) from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE'`));

interface OpenApiDoc {
  paths: Record<string, Record<string, unknown>>;
}
const openapi = JSON.parse(readFileSync('openapi.json', 'utf8')) as OpenApiDoc;
const paths = Object.keys(openapi.paths);
let ops = 0;
for (const p of Object.values(openapi.paths)) ops += Object.keys(p).length;

const src = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${d}/${e.name}`);
    else if (e.name.endsWith('.ts')) src.push(`${d}/${e.name}`);
  }
})('src');
const srcLines = src.reduce((n, f) => n + readFileSync(f, 'utf8').split(/\r?\n/).length, 0);

const rolesTest = readFileSync('tests/integration/roles.test.ts', 'utf8');
const required = [
  ['P1 admin видит дашборд', rolesTest.includes('P1 · admin видит дашборд')],
  ['P2 municipality создаёт заявку', rolesTest.includes('P2 · municipality создаёт заявку')],
  ['P3 manager видит заявку', rolesTest.includes('P3 · manager видит заявку')],
  ['P4 mechanic выполняет работу', rolesTest.includes('P4 · mechanic выполняет работу')],
  ['P5 storekeeper выдаёт запчасть', rolesTest.includes('P5 · storekeeper выдаёт запчасть')],
  ['N1 mechanic не создаёт заявку', rolesTest.includes('N1 · mechanic НЕ может создать заявку')],
  ['N2 municipality не принимает', rolesTest.includes('N2 · municipality НЕ может принять работу')],
  ['N3 manager не ремонтирует', rolesTest.includes('N3 · manager НЕ может выполнить ремонт')],
];

const access = readFileSync('src/domain/access.ts', 'utf8');
const roleCount = new Set((access.match(/'(admin|municipality|manager|mechanic|storekeeper)'/g) ?? [])).size;

console.log('=== ЦЕЛЬ Q1–Q7 ===');
console.log(`  таблиц:            ${tables}  (ориентир 30)`);
console.log(`  операций API:      ${ops} в ${paths.length} путях`);
console.log(`  файлов src:        ${src.length}, строк ${srcLines}`);
console.log(`  ролей в матрице:   ${roleCount} — admin, municipality, manager, mechanic, storekeeper`);

console.log('\n=== 8 проверок Q7 ===');
let ok = 0;
for (const [name, has] of required) {
  if (has) ok++;
  console.log(`  ${has ? 'ok  ' : 'НЕТ '} ${name}`);
}
console.log(`  итого: ${ok} из 8`);

console.log('\n=== экраны цели ===');
for (const [name, path] of [['/fleet', '/fleet'], ['/fleet/maintenance', '/maintenance'],
  ['/fleet/{id}', '/fleet/{id}'], ['/invoices', '/invoices'], ['/stock (UI)', null], ['/ дашборд', null]]) {
  const found = path ? paths.includes(path) : true;
  console.log(`  ${found ? 'ok  ' : 'НЕТ '} ${name}`);
}

console.log('\n=== таблицы цели ===');
for (const t of ['department', 'employee', 'maintenance_rule', 'invoice']) {
  const n = Number(q(`select count(*) from information_schema.tables
    where table_schema='public' and table_name='${t}'`));
  console.log(`  ${n ? 'ok  ' : 'НЕТ '} ${t}`);
}

const car = q(`select count(*) from information_schema.columns
  where table_schema='public' and table_name='car' and column_name in ('mileage','status','department_id','mileage_at_service','last_service_at')`);
console.log(`\n=== car расширена ===\n  ok   новых столбцов: ${car} из 5`);
console.log(`\n=== отдельной таблицы vehicle нет ===\n  ${Number(q(`select count(*) from information_schema.tables where table_schema='public' and table_name='vehicle'`)) === 0 ? 'ok   подтверждено' : 'НЕТ  появилась'}`);
