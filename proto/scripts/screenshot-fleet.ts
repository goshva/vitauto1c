import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Снимки новых экранов: автопарк, список ТО, счета, склад.
// Нужны, чтобы глазами проверить то, что тесты проверяют утверждениями.

const PORT = Number(process.env.PROTO_PORT ?? 18195);
const BASE = `http://127.0.0.1:${PORT}`;

const bunPath = (): string => {
  const p = process.env.APPDATA ? join(process.env.APPDATA, 'npm/node_modules/bun/bin/bun.exe') : '';
  return p && existsSync(p) ? p : 'bun';
};

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

// Данные: справочники и остаток, чтобы склад был непустым.
execFileSync(bunPath(), ['run', 'db/seed.ts'], { cwd: process.cwd(), stdio: 'ignore' });

const browser = await chromium.launch({ args: ['--no-proxy-server'], ...(process.env.CI ? {} : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

// Счёт, чтобы экран счетов был непустым.
await page.request.post(`${BASE}/invoices`, {
  data: { counterpartyId: '66666666-6666-6666-6666-666666666601', amount: '12500.00', comment: 'Ремонт по заявке № 14' },
});
// Остаток на складе.
await page.request.post(`${BASE}/stock/moves`, {
  data: {
    nomenclatureId: '77777777-7777-7777-7777-777777777701',
    warehouseId: '44444444-4444-4444-4444-444444444401',
    cellId: '88888888-8888-8888-8888-888888888802',
    kind: 'receipt', quantity: '24',
  },
});

for (const [url, file] of [
  ['/fleet', 'logs/screen-6-fleet.png'],
  ['/fleet/maintenance', 'logs/screen-7-maintenance.png'],
  ['/invoices', 'logs/screen-8-invoices.png'],
  ['/stock', 'logs/screen-9-stock.png'],
]) {
  await page.goto(`${BASE}${url}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  ${url} → ${file}`);
}

await browser.close();
server.kill();
console.log('снимки готовы');
