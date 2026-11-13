import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Снимки карты процессов: общая схема со статистикой и карточка процесса.
// Нужны, чтобы глазами проверить то, что тесты проверяют утверждениями.

const PORT = Number(process.env.PROTO_PORT ?? 18194);
const BASE = `http://127.0.0.1:${PORT}`;

function bunPath(): string {
  const p = process.env.APPDATA ? join(process.env.APPDATA, 'npm/node_modules/bun/bin/bun.exe') : '';
  return p && existsSync(p) ? p : 'bun';
}

const useSystemChrome = !process.env.CI;
const server = Bun.spawn([bunPath(), 'run', 'src/server.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT) },
  stdout: 'ignore',
  stderr: 'ignore',
});

for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* поднимается */ }
  await new Promise((r) => setTimeout(r, 250));
}

// Данные: ВИТРИНА — по строке на каждый этап каждого процесса. Тогда на схеме
// «живым» видно каждый шаг, а не только те, через которые прошли два сида.
execFileSync(bunPath(), ['run', 'db/seed.ts', '--showcase'], { cwd: process.cwd(), stdio: 'ignore' });

const browser = await chromium.launch({ args: ['--no-proxy-server'], ...(useSystemChrome ? { channel: 'chrome' } : {}) });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

await page.goto(`${BASE}/processes`);
await page.getByTestId('process-list').waitFor();
await page.screenshot({ path: 'logs/screen-4-processes.png', fullPage: true });

// Переключение на другой процесс — тем же HTMX-запросом, что делает браузер.
await page.getByTestId('process-return').click();
await page.getByTestId('process-panel').waitFor();
await page.screenshot({ path: 'logs/screen-5-process-return.png', fullPage: true });

await browser.close();
server.kill();

console.log('снимки: logs/screen-4-processes.png, logs/screen-5-process-return.png');
