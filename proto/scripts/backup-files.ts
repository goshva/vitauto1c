import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PG_BIN } from './backup-lib.ts';
import type { BackupFile } from './backup-types.ts';

// Работа с файлами копий: слепок файла, имена, перечень, уборка старых.
//
// Отдельно от `backup-lib.ts`, потому что назначение другое: там — что лежит в базе,
// здесь — что лежит на диске. И по размеру: вместе они выходили за предел экспортов.

/** Слепок файла: по нему видно, что копию не подменили и не усекли. */
export function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Версия `pg_dump` — в описи: копия, снятая другой версией, восстанавливается не всегда. */
export function pgDumpVersion(env: NodeJS.ProcessEnv): string {
  return execFileSync(`${PG_BIN}\\pg_dump.exe`, ['--version'], { encoding: 'utf8', env }).trim();
}

/** Имя копии: время в имени, а не только в описи — по нему ищут глазами. */
export function stampName(when: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}`
    + `-${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`;
}

/** Копии в папке, от свежих к старым. */
export function listBackups(dir: string): BackupFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.dump'))
    .map((f) => {
      const dump = join(dir, f);
      return {
        stamp: f.replace(/^vitauto-/, '').replace(/\.dump$/, ''),
        dump,
        manifest: join(dir, f.replace(/\.dump$/, '.json')),
        bytes: statSync(dump).size,
      };
    })
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
}

/** Удалить старые копии, оставив `keep` свежих. */
export function prune(dir: string, keep: number): BackupFile[] {
  const removed = listBackups(dir).slice(keep);
  for (const b of removed) {
    unlinkSync(b.dump);
    // Опись убираем следом: копия без файла вводила бы в заблуждение — она выглядит
    // как копия, а восстановить из неё нечего.
    try { unlinkSync(b.manifest); } catch { /* описи могло не быть */ }
  }
  return removed;
}
