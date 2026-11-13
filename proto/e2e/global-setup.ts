import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Подготовка базы перед e2e: справочники + все сиды процессов.
//
// Почему через отдельный процесс, а не импортом `db/seed.ts`: e2e выполняется
// транспайлером Playwright (Node), а `db/seed.ts` рассчитан на Bun — там `bun run`.
// Отдельный процесс даёт ту же базу и не тянет Bun-специфику в Node.
//
// `process.cwd()`, а не `import.meta.dir`: Playwright транспилирует setup в CJS,
// и `import.meta.dir` там undefined — падает «paths[0] must be of type string».
//
// Путь к `bun` ищется явно: в PATH лежит `bun.ps1` (обёртка npm), который
// `execFileSync` не запускает — падает «spawnSync bun ENOENT». Сам `.exe` рядом.
//
// Сами сценарии создают данные ЧЕРЕЗ ЭКРАН (форма загрузки листа), как это делал бы
// оператор. Сид даёт только то, что оператор не создаёт: справочники.

function bunPath(): string {
  const candidates = [
    process.env.BUN_PATH,
    process.env.APPDATA ? join(process.env.APPDATA, 'npm/node_modules/bun/bin/bun.exe') : undefined,
    'bun',
  ].filter((p): p is string => Boolean(p));

  for (const c of candidates) {
    if (c === 'bun' || existsSync(c)) return c;
  }
  return 'bun';
}

export default function globalSetup(): void {
  execFileSync(bunPath(), ['run', 'db/seed.ts', '--all'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env },
  });
}
