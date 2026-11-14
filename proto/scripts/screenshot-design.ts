import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Снимки нового дизайна: оболочка целиком (панель + верхняя панель + контент),
// список, дашборд и тёмная тема.

const PORT = Number(process.env.PROTO_PORT ?? 18197);
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

// Витрина: на каждом этапе каждого процесса есть строки — список не пустой.
execFileSync(bunPath(), ['run', 'db/seed.ts', '--showcase'], { cwd: process.cwd(), stdio: 'ignore' });

const browser = await chromium.launch({ args: ['--no-proxy-server'], ...(process.env.CI ? {} : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

for (const [url, file] of [
  ['/', 'logs/screen-12-design-dashboard.png'],
  ['/lines', 'logs/screen-13-design-lines.png'],
  ['/fleet', 'logs/screen-14-design-fleet.png'],
]) {
  await page.goto(`${BASE}${url}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  ${url} → ${file}`);
}

// Тёмная тема: переключаем тем же способом, что и кнопка в панели.
await page.goto(`${BASE}/lines`);
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.waitForTimeout(150);
await page.screenshot({ path: 'logs/screen-15-design-dark.png', fullPage: true });
console.log('  /lines (тёмная) → logs/screen-15-design-dark.png');

// Телефон: панель должна стать нижней навигацией.
const phone = await browser.newPage({ viewport: { width: 420, height: 900 } });
await phone.goto(`${BASE}/lines`);
await phone.waitForLoadState('networkidle');
await phone.screenshot({ path: 'logs/screen-16-design-mobile.png', fullPage: false });
console.log('  /lines (телефон) → logs/screen-16-design-mobile.png');

await browser.close();
server.kill();
console.log('снимки готовы');
