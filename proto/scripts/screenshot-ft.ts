import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Снимок: подсветка срочности в списке (ФТ v2 п. 9) и отказ клиента (п. 15).

const PORT = 18202;
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

execFileSync(bunPath(), ['run', 'db/seed.ts', '--showcase'], { cwd: process.cwd(), stdio: 'ignore' });

const browser = await chromium.launch({ args: ['--no-proxy-server'], ...(process.env.CI ? {} : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

// Помечаем две строки срочными.
const ids = (await (await page.request.get(`${BASE}/lines?limit=6`)).json()).items as { id: string }[];
for (const line of ids.slice(0, 2)) {
  await page.request.patch(`${BASE}/lines/${line.id}`, {
    data: { field: 'urgency', value: 'Срочно' },
  });
}

await page.goto(`${BASE}/lines`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: 'logs/screen-23-urgency.png', fullPage: true });

const urgent = await page.locator('tr.row-urgent').count();
const chips = await page.getByText('Срочно', { exact: true }).count();
console.log(`  /lines → logs/screen-23-urgency.png (подсвечено строк: ${urgent}, меток: ${chips})`);

// Отказ клиента: отменяем строку и смотрим список.
await page.request.post(`${BASE}/lines/${ids[2]!.id}/mark`, { data: { marked: true } });
await page.request.post(`${BASE}/lines/transition`, { data: { to: 'cancelled' } });
await page.goto(`${BASE}/lines?status=cancelled`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: 'logs/screen-24-cancelled.png', fullPage: true });
console.log('  /lines?status=cancelled → logs/screen-24-cancelled.png');

await browser.close();
server.kill();
