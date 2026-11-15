import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Запуск копии и её проверки из регламентного задания.
//
// ПОЧЕМУ ЧЕРЕЗ КОМАНДУ, А НЕ ЧЕРЕЗ ИМПОРТ. Снятие копии — это `pg_dump`, внешняя
// программа. Импортировать `scripts/backup.ts` значило бы выполнить его побочные
// действия при загрузке модуля (он читает аргументы командной строки и сразу работает).
// Отсюда — запуск отдельным процессом с готовыми ааргументамигументами.
//
// РЕЗУЛЬТАТ ЧИТАЕМ ИЗ ОПИСИ, А НЕ ИЗ ВЫВОДА. Вывод команды — для человека; опись —
// для программы. Разбирать человеческий текст значило бы сломаться от правки
// формулировки.

const DIR = 'backups';

const env = { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'postgres' };

function run(script: string, args: string[]): string {
  return execFileSync('bun', ['run', `scripts/${script}`, ...args], {
    encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Снять копию. Возвращает сообщение для истории пусков. */
export async function runBackup(): Promise<string> {
  run('backup.ts', ['--dir', DIR, '--keep', '7']);

  // Свежая копия — та, чья опись новее всех остальных.
  const latest = JSON.parse(
    readFileSync(join(DIR, latestManifest()), 'utf8'),
  ) as { totalRows: number; bytes: number };
  const mb = (latest.bytes / 1024 / 1024).toFixed(2);
  return `копия снята: строк ${latest.totalRows}, ${mb} МБ`;
}

/** Проверить последнюю копию восстановлением. */
export async function runVerify(): Promise<string> {
  const out = run('backup-verify.ts', ['--dir', DIR]);
  return out.includes('КОПИЯ ГОДИТСЯ') ? 'проверка пройдена' : 'проверка НЕ пройдена';
}

/** Имя самой свежей описи: по времени в имени, а не по времени файла. */
function latestManifest(): string {
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const names = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  const last = names[names.length - 1];
  if (!last) throw new Error('копий нет: снятие не удалось');
  return last;
}
