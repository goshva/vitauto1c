import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Снимок нового экрана неопознанных и наряда с описанием неисправности.

const PORT = 18201;
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

execFileSync(bunPath(), ['run', 'db/seed.ts'], { cwd: process.cwd(), stdio: 'ignore' });
execFileSync(bunPath(), ['run', 'db/seed.ts', '--off'], { cwd: process.cwd(), stdio: 'ignore' });

const browser = await chromium.launch({ args: ['--no-proxy-server'], ...(process.env.CI ? {} : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

await page.goto(`${BASE}/unidentified`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: 'logs/screen-21-unidentified.png', fullPage: true });
const rows = await page.getByTestId('unidentified-table').locator('tbody tr').count();
console.log(`  /unidentified → logs/screen-21-unidentified.png (строк: ${rows})`);

// Наряд с описанием неисправности.
const created = await page.request.post(`${BASE}/work-orders`, {
  data: {
    carId: 'cccccccc-cccc-cccc-cccc-cccccccccc03',
    counterpartyId: '66666666-6666-6666-6666-666666666601',
    serviceTypeId: '22222222-2222-2222-2222-222222222202',
    comment: 'Стучит спереди справа на неровностях, усилилось за неделю',
  },
});
const id = String((await created.json()).id);
await page.request.post(`${BASE}/work-orders/${id}/labor`, {
  data: { name: 'Диагностика ходовой', normHours: '1.2', salePrice: '1500',
    executorId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04' },
});

await page.goto(`${BASE}/print/work_order?workOrderId=${id}`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: 'logs/screen-22-work-order-comment.png', fullPage: true });
const hasComment = (await page.content()).includes('Стучит спереди справа');
console.log(`  наряд с описанием → logs/screen-22-work-order-comment.png (описание в форме: ${hasComment})`);

await browser.close();
server.kill();