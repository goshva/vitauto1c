import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

// Финальная сверка гейтов 0–6. Один прогон — одно место с доказательствами.
//
// Метки в SQL — ТОЛЬКО ASCII: psql в этой среде отвечает «invalid byte sequence
// for encoding UTF8» на кириллицу внутри запроса. Русский текст печатается
// средствами JS, а не базой.

const psql = 'C:\\Program Files\\PostgreSQL 1C\\18\\bin\\psql.exe';
const proto = 'postgres://postgres:postgres@127.0.0.1:5434/vitauto_proto';
const legacy = 'postgres://postgres:postgres@127.0.0.1:5434/vitauto_app';
const env = { ...process.env, PGPASSWORD: 'postgres' };
const bunExe = `${process.env.APPDATA}\\npm\\node_modules\\bun\\bin\\bun.exe`;

const q = (db: string, sql: string): string => execFileSync(psql, [db, '-Atc', sql], { encoding: 'utf8', env }).trim();

const SQL = `select
    (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
 || '/' || (select count(*) from information_schema.views where table_schema='public')
 || '/' || (select count(*) from information_schema.columns where table_schema='public' and table_name='line')
 || '/' || (select count(*) from warehouse_zone)
 || '/' || (select count(*) from information_schema.columns where table_schema='public' and column_name like 'onec%')
 || '/' || (select count(*) from information_schema.triggers where trigger_schema='public')`;

console.log('=== GATE 0: каркас и изоляция ===');
console.log('  базы:', q('postgres://postgres:postgres@127.0.0.1:5434/postgres',
  "select string_agg(datname, ', ') from pg_database where datname in ('vitauto_proto','vitauto_app')"));

console.log('=== GATE 1: схема БД ===');
const [tables, views, line, zones, onec, triggers] = q(proto, SQL).split('/');
console.log(`  таблиц=${tables} представлений=${views} line=${line} зон=${zones}`);
console.log(`  наследие_1С=${onec} триггеров=${triggers}`);
console.log('  сидов процессов:', readdirSync('db/seed/processes').length);

console.log('=== GATE 2: API ===');
interface OpenApi { paths: Record<string, Record<string, unknown>> }
const openapi = JSON.parse(readFileSync('openapi.json', 'utf8')) as OpenApi;
let ops = 0;
for (const paths of Object.values(openapi.paths)) ops += Object.keys(paths).length;
console.log(`  путей=${Object.keys(openapi.paths).length} операций=${ops}`);
// `readdirSync` возвращает и каталоги: `src/domain` и `src/views` — папки,
// читать их как файлы нельзя (EISDIR). Считаем только .ts.
const problemDefs = readdirSync('src', { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.ts'))
  .filter((e) => /export class Problem\b/.test(readFileSync(`src/${e.name}`, 'utf8'))).length;
console.log('  определений типа Problem:', problemDefs);

console.log('=== GATE 3+4: экраны и процессы ===');
console.log('  e2e-файлов:', readdirSync('e2e').length);
console.log('  отчётов гейтов:', readdirSync('logs').filter((f) => /^stage-\d-gate\.md$/.test(f)).length);
console.log('  файлов src:', readdirSync('src').length);

console.log('=== GATE 6: типы и архитектура ===');
let tscErrors = -1;
try {
  execFileSync(bunExe, ['run', 'typecheck'], { encoding: 'utf8', env, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  tscErrors = 0;
} catch (e) {
  const err = e as { stdout?: string; stderr?: string };
  tscErrors = (String(err.stdout ?? '') + String(err.stderr ?? '')).match(/error TS\d+/g)?.length ?? 1;
}
console.log('  ошибок типов:', tscErrors);
const arch = execFileSync(bunExe, ['run', 'arch'], { encoding: 'utf8', env, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
console.log(' ', arch.trim());

console.log('=== ИЗОЛЯЦИЯ ручного стенда ===');
console.log('  vitauto_app arm.line =', q(legacy, 'select count(*) from arm.line'));
