import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Снимок карты процессов: видно, что число у шага — счётчик строк в состоянии.

const PORT = 18200;
const BASE = `http://127.0.0.1:${PORT}`;
const bunPath = (): string => {
  const p = process.env.APPDATA ? join(process.env.APPDATA, 'npm/node_modules/bun/bin/bun.exe') : '';
  return p && existsSync(p) ? p : 'bun';
};

const server = Bun.spawn([bunPath(), 'run', 'src/server.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT) },
  stdout: 'ignore', stderr: 'ignore',
});
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* поднимается */ }
  await new Promise((r) => setTimeout(r, 250));
}

// Витрина И внепроцессные узлы: показать оба набора.
execFileSync(bunPath(), ['run', 'db/seed.ts', '--showcase'], { cwd: process.cwd(), stdio: 'ignore' });
execFileSync(bunPath(), ['run', 'db/seed.ts', '--off'], { cwd: process.cwd(), stdio: 'ignore' });

const browser = await chromium.launch({ args: ['--no-proxy-server'], ...(process.env.CI ? {} : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

await page.goto(`${BASE}/processes/happy`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: 'logs/screen-19-process-counts.png', fullPage: true });

// Что реально показывает шаг 13 (Уведомление о готовности, состояние «Собрано»).
const shown = await page.getByTestId('step-count-13').textContent();
const status = await page.getByTestId('step-status-13').textContent();

await page.goto(`${BASE}/stock`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: 'logs/screen-20-stock.png', fullPage: true });

await browser.close();
server.kill();
console.log(`  шаг 13: состояние «${status?.trim()}», счётчик = ${shown?.trim()}`);
console.log('  снимки: logs/screen-19-process-counts.png, logs/screen-20-stock.png');
