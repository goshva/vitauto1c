import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { PG_BIN, dbUrl, pgEnv, snapshot, totals } from './backup-lib.ts';
import { fileSha256, listBackups } from './backup-files.ts';
import type { Manifest, TableFingerprint } from './backup-types.ts';

// ПРОВЕРКА КОПИИ ВОССТАНОВЛЕНИЕМ.
//
//   bun run scripts/backup-verify.ts             — последняя копия
//   bun run scripts/backup-verify.ts 20261115-1600
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ КОМАНДА, А НЕ СТРОКА В ОТЧЁТЕ. Копия, которую ни разу не
// восстанавливали, копией не является: файл может быть усечён, опись — устареть, а
// восстановление — упереться в отсутствующее расширение. Узнать об этом лучше сейчас,
// чем в день аварии.
//
// ЧТО ИМЕННО ПРОВЕРЯЕТСЯ:
//   1. контрольная сумма файла совпадает с описью — копию не подменили и не усекли;
//   2. дамп восстанавливается в ЧУЖУЮ (временную) базу — не в рабочую;
//   3. слепок содержимого восстановленного совпадает со слепком на момент снятия.
//
// Третье и есть доказательство. Первое и второе — условия, без которых третье
// ничего не значит.
//
// ВРЕМЕННАЯ БАЗА УДАЛЯЕТСЯ ВСЕГДА, даже при провале: иначе следующая проверка
// упёрлась бы в неё, а на диске копились бы чужие данные.

const args = process.argv.slice(2);
const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1]! : 'backups';
const wanted = args.find((a) => !a.startsWith('--') && /^\d{8}-\d{6}$/.test(a));

const backups = listBackups(dir);
if (backups.length === 0) {
  console.error(`Копий нет в ${dir}. Сначала: bun run scripts/backup.ts`);
  process.exit(2);
}

const backup = wanted ? backups.find((b) => b.stamp === wanted) : backups[0];
if (!backup) {
  console.error(`Копия ${wanted} не найдена. Есть: ${backups.map((b) => b.stamp).join(', ')}`);
  process.exit(2);
}
if (!existsSync(backup.manifest)) {
  console.error(`Опись ${backup.manifest} отсутствует — проверить копию нечем.`);
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(backup.manifest, 'utf8')) as Manifest;
const env = pgEnv();
const tmp = `vitauto_verify_${backup.stamp.replace(/\D/g, '')}`;

console.log(`проверка копии ${backup.stamp}`);
console.log(`  опись снята: ${manifest.createdAt}, база: ${manifest.database}`);

const problems: string[] = [];

// 1. Файл.
const sha = fileSha256(backup.dump);
if (sha !== manifest.fileSha256) {
  problems.push(`контрольная сумма файла не совпала с описью (${sha.slice(0, 12)} ≠ ${manifest.fileSha256.slice(0, 12)})`);
} else {
  console.log(`  файл: цел, sha256 ${sha.slice(0, 16)}…`);
}

// 2. Восстановление в ЧУЖУЮ базу.
try {
  execFileSync(`${PG_BIN}\\dropdb.exe`,
    [`--maintenance-db=${dbUrl('postgres')}`, '--if-exists', '--force', tmp],
    { env, stdio: 'ignore' });
  execFileSync(`${PG_BIN}\\createdb.exe`,
    [`--maintenance-db=${dbUrl('postgres')}`, tmp], { env, stdio: 'ignore' });
  console.log(`  временная база ${tmp} создана`);

  execFileSync(`${PG_BIN}\\pg_restore.exe`, [
    '--dbname', dbUrl(tmp), '--no-owner', '--no-privileges', '--exit-on-error', backup.dump,
  ], { stdio: ['ignore', 'ignore', 'pipe'], env });
  console.log('  восстановление прошло без ошибок');

  // 3. Слепок содержимого.
  const restored: TableFingerprint[] = snapshot(dbUrl(tmp), env);
  const now = totals(restored);

  if (now.checksum === manifest.totalChecksum) {
    console.log(`  содержимое: совпало — ${now.rows} строк, слепок ${now.checksum.slice(0, 16)}…`);
  } else {
    problems.push(`содержимое НЕ совпало: строк ${now.rows} вместо ${manifest.totalRows}`);
    for (const t of restored) {
      const was = manifest.tables.find((x) => x.table === t.table);
      if (!was) { problems.push(`таблица ${t.table} есть в копии, но её не было в описи`); continue; }
      if (was.rows !== t.rows) {
        problems.push(`таблица ${t.table}: строк ${t.rows} вместо ${was.rows}`);
      } else if (was.checksum !== t.checksum) {
        // Строктрок столько же, а содержимое другое — это не «недоехало», это порча.
        problems.push(`таблица ${t.table}: число строк совпало, содержимое отличается`);
      }
    }
    for (const t of manifest.tables) {
      if (!restored.some((x) => x.table === t.table)) {
        problems.push(`таблица ${t.table} пропала при восстановлении`);
      }
    }
  }
} catch (e) {
  problems.push(`восстановление не прошло: ${(e as Error).message.split('\n')[0]}`);
} finally {
  execFileSync(`${PG_BIN}\\dropdb.exe`,
    [`--maintenance-db=${dbUrl('postgres')}`, '--if-exists', '--force', tmp],
    { env, stdio: 'ignore' });
  console.log(`  временная база ${tmp} удалена`);
}

if (problems.length > 0) {
  console.error('\nКОПИЯ НЕ ГОДИТСЯ:');
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

console.log('\nКОПИЯ ГОДИТСЯ: восстановление даёт то же содержимое, что было при снятии.');
