import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Снимки печатных форм ремонта: заказ-наряд и акт выполненных работ.
// Формы печатные, поэтому снимаем в режиме страницы целиком, а не окна.

const PORT = Number(process.env.PROTO_PORT ?? 18196);
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

execFileSync(bunPath(), ['run', 'db/seed.ts'], { cwd: process.cwd(), stdio: 'ignore' });

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc03'; // в ремонте
const SERVICE = '22222222-2222-2222-2222-222222222201';
const NOM = '77777777-7777-7777-7777-777777777701';
const WH = '44444444-4444-4444-4444-444444444401';
const CELL = '88888888-8888-8888-8888-888888888802';
const CUSTOMER = '66666666-6666-6666-6666-666666666601';
const MECHANIC = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04';

const browser = await chromium.launch({ args: ['--no-proxy-server'], ...(process.env.CI ? {} : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });

const created = await page.request.post(`${BASE}/work-orders`, {
  data: { carId: CAR, counterpartyId: CUSTOMER, serviceTypeId: SERVICE },
});
const id = String((await created.json()).id);

await page.request.post(`${BASE}/work-orders/${id}/labor`, {
  data: { name: 'Замена масла в двигателе', normHours: '1.5', salePrice: '1500', executorId: MECHANIC },
});
await page.request.post(`${BASE}/work-orders/${id}/labor`, {
  data: { name: 'Замена масляного фильтра', normHours: '0.4', salePrice: '1200', executorId: MECHANIC },
});
await page.request.post(`${BASE}/stock/moves`, {
  data: { nomenclatureId: NOM, warehouseId: WH, cellId: CELL, kind: 'receipt', quantity: '10' },
});
await page.request.post(`${BASE}/work-orders/${id}/part`, {
  data: { nomenclatureId: NOM, quantity: '2', salePrice: '900' },
});

for (const [url, file] of [
  [`/print/work_order?workOrderId=${id}`, 'logs/screen-10-work-order.png'],
  [`/print/work_act?workOrderId=${id}`, 'logs/screen-11-work-act.png'],
] as [string, string][]) {
  await page.goto(`${BASE}${url}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  ${url.split('?')[0]} → ${file}`);
}

await browser.close();
server.kill();
console.log('снимки готовы');
