import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Снимки свёрнутой и развёрнутой панели: показать, что «Свернуть» работает
// и состояние сохраняется.

const PORT = 18199;
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

const browser = await chromium.launch({ args: ['--no-proxy-server'], ...(process.env.CI ? {} : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

await page.goto(`${BASE}/lines`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: 'logs/screen-17-nav-expanded.png', fullPage: false });
console.log('  развёрнутая → logs/screen-17-nav-expanded.png');

await page.getByTestId('nav-toggle').click();
await page.waitForTimeout(250);
await page.screenshot({ path: 'logs/screen-18-nav-collapsed.png', fullPage: false });
console.log('  свёрнутая   → logs/screen-18-nav-collapsed.png');

// Проверяем, что состояние запомнилось: перезагрузка его не сбрасывает.
await page.reload();
await page.waitForLoadState('networkidle');
const stored = await page.evaluate(() => localStorage.getItem('arm.nav'));
const w = await page.evaluate(() => Math.round(document.querySelector('.navbar')!.getBoundingClientRect().width));
console.log(`  после перезагрузки: localStorage['arm.nav']=${stored}, ширина панели ${w}px`);

await browser.close();
server.kill();
console.log('готово');
