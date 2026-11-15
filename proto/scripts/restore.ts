import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { PG_BIN, dbUrl, pgEnv } from './backup-lib.ts';
import { fileSha256, listBackups } from './backup-files.ts';
import type { Manifest } from './backup-types.ts';

// ВОССТАНОВЛЕНИЕ ИЗ КОПИИ — то, что делают в день аварии.
//
//   bun run scripts/restore.ts 20261115-1600 --to vitauto_proto
//   bun run scripts/restore.ts 20261115-1600 --to vitauto_new --create
//
// ПОЧЕМУ НУЖНО ЯВНО НАЗВАТЬ БАЗУ. Восстановление затирает всё, что в целевой базе
// есть. Команда, которая по умолчанию бьёт в рабочую базу, — это команда, которую
// однажды запустят по ошибке, и восстанавливать будет уже нечего. Поэтому без `--to`
// она не делает ничего.
//
// ПОЧЕМУ СНАЧАЛА ПРОВЕРЯЕТСЯ ФАЙЛ. Восстанавливать из подменённой или усечённой копии
// хуже, чем не восстанавливать: получится база, которая выглядит рабочей, но в ней
// не хватает строк. Контрольная сумма сверяется с описью ДО того, как что-то
// изменится.

const args = process.argv.slice(2);
const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1]! : 'backups';
const to = args.includes('--to') ? args[args.indexOf('--to') + 1] : undefined;
const create = args.includes('--create');
const stamp = args.find((a) => !a.startsWith('--') && /^\d{8}-\d{6}$/.test(a));

if (!to) {
  console.error('Не указана целевая база. Пример:\n'
    + '  bun run scripts/restore.ts 20261115-1600 --to vitauto_proto\n\n'
    + 'Целевую базу нужно назвать явно: восстановление ЗАТИРАЕТ её содержимое, и\n'
    + 'удара по рабочей базеазе по умолчанию быть не должно.');
  process.exit(2);
}

const backups = listBackups(dir);
const backup = stamp ? backups.find((b) => b.stamp === stamp) : backups[0];
if (!backup) {
  console.error(`Копия не найдена. Есть: ${backups.map((b) => b.stamp).join(', ') || 'ни одной'}`);
  process.exit(2);
}
if (!existsSync(backup.manifest)) {
  console.error(`Опись ${backup.manifest} отсутствует — копию нельзя проверить, а без этого восстанавливать нельзя.`);
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(backup.manifest, 'utf8')) as Manifest;
const env = pgEnv();

console.log(`восстановление копии ${backup.stamp} → база ${to}`);

const sha = fileSha256(backup.dump);
if (sha !== manifest.fileSha256) {
  console.error(`ОТКАЗ: контрольная сумма файла не совпала с описью.\n`
    + `  файл: ${sha}\n  опись: ${manifest.fileSha256}\n`
    + 'Восстанавливать из непроверенной копии нельзя: получится база, которая\n'
    + 'выглядит рабочей, но в ней может не хватать строк.');
  process.exit(1);
}
console.log(`  файл проверен: sha256 ${sha.slice(0, 16)}…`);

if (create) {
  execFileSync(`${PG_BIN}\\dropdb.exe`,
    [`--maintenance-db=${dbUrl('postgres')}`, '--if-exists', '--force', to],
    { env, stdio: 'ignore' });
  execFileSync(`${PG_BIN}\\createdb.exe`,
    [`--maintenance-db=${dbUrl('postgres')}`, to], { env, stdio: 'ignore' });
  console.log(`  база ${to} создана заново`);
}

// `--clean --if-exists`: без этого восстановление в непустую базу упирается в
// существующие таблицы и падает на середине — то есть оставляет базу в
// половинчатом состоянии.
execFileSync(`${PG_BIN}\\pg_restore.exe`, [
  '--dbname', dbUrl(to), '--clean', '--if-exists', '--no-owner', '--no-privileges',
  '--exit-on-error', backup.dump,
], { stdio: ['ignore', 'ignore', 'inherit'], env });

console.log(`  восстановлено: ${manifest.totalRows} строк, ${manifest.tables.length} таблиц`);
console.log('\nТеперь ОБЯЗАТОБЯЗАТЕЛЬНОЛЬНО проверьте копию:');
console.log(`  bun run scripts/backup-verify.ts ${backup.stamp}`);
console.log('Восстановление без проверки — это ещё не восстановление.');
