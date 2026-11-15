import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PG_BIN, dbUrl, pgEnv, snapshot, totals } from './backup-lib.ts';
import { fileSha256, listBackups, pgDumpVersion, prune, stampName } from './backup-files.ts';
import type { Manifest } from './backup-types.ts';

// Снятие копии базы.
//
//   bun run scripts/backup.ts                 — в backups/, оставить 7 последних
//   bun run scripts/backup.ts --keep 30       — хранить 30
//   bun run scripts/backup.ts --dir D:\backup — в другую папку
//
// ЧТО ЗДЕСЬ ГЛАВНОЕ. Копия снимается ВМЕСТЕ С ОПИСЬЮ: слепок содержимого каждой
// таблицы на момент снятия. Без описи проверить копию нечем — о��таётся верить, что
// файл непустой. С описью `backup-verify.ts` доказывает, что восстановленное
// совпадает с тем, что было.
//
// ВНЕШНИЙ НОСИТЕЛЬ НЕ ПРЕДУСМОТРЕН, И ЭТО НАДО СКАЗАТЬ ПРЯМО: копии лежат на той же
// машине, что и база, и от потери диска не спасают. Они спасают от порчи данных и от
// ошибочной правки. Копирование на другой носитель — отдельная задача.

const args = process.argv.slice(2);
const argOf = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const dir = argOf('dir', 'backups');
const keep = Number(argOf('keep', '7'));
const source = argOf('db', 'vitauto_proto');

if (!Number.isInteger(keep) || keep < 1) {
  console.error('--keep должен быть целым числом не меньше 1');
  process.exit(2);
}

const env = pgEnv();
const url = dbUrl(source);
const stamp = stampName();
const dumpPath = join(dir, `vitauto-${stamp}.dump`);
const manifestPath = join(dir, `vitauto-${stamp}.json`);

if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

console.log(`копия базы ${source} → ${dumpPath}`);

// Опись снимается ДО дампа: так в неё попадает состояние, которое и должно оказаться
// в копии. Снимок после дампа отличался бы, если бы базу правили в это время.
const before = snapshot(url, env);
const t = totals(before);
console.log(`  таблиц: ${before.length}, строк: ${t.rows}`);

// `-Fc` — свой формат: сжатие, восстановление по частям и проверка целостности самим
// `pg_restore`. Обычный SQL пришлось бы восстанавливать целиком и без проверки.
execFileSync(
  `${PG_BIN}\\pg_dump.exe`,
  ['--format=custom', '--no-owner', '--no-privileges', '--file', dumpPath, url],
  { stdio: ['ignore', 'ignore', 'inherit'], env },
);

const manifest: Manifest = {
  createdAt: new Date().toISOString(),
  database: source,
  file: dumpPath.replace(/\\/g, '/'),
  bytes: statSync(dumpPath).size,
  fileSha256: fileSha256(dumpPath),
  pgDumpVersion: pgDumpVersion(env),
  tables: before,
  totalRows: t.rows,
  totalChecksum: t.checksum,
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`  размер: ${(manifest.bytes / 1024 / 1024).toFixed(2)} МБ`);
console.log(`  sha256: ${manifest.fileSha256.slice(0, 16)}…`);
console.log(`  опись:  ${manifestPath}`);

const removed = prune(dir, keep);
if (removed.length > 0) {
  console.log(`  удалено старых: ${removed.length} (${removed.map((x) => x.stamp).join(', ')})`);
}
console.log(`  всего копий: ${listBackups(dir).length} из ${keep}`);

// Проверка «копия ЧИТАЕТСЯ» — дешёвая и обязательная: `pg_restore --list` разбирает
// оглавление дампа и падает на усечённом файле. Полное доказательство даёт только
// восстановление — отдельной командой.
const listing = execFileSync(`${PG_BIN}\\pg_restore.exe`, ['--list', dumpPath], {
  encoding: 'utf8', env,
});
console.log(`  оглавление читается: объектов ${(listing.match(/;/g) ?? []).length}`);
console.log(`\nПроверьте копию восстановлением:\n  bun run scripts/backup-verify.ts ${stamp}`);
