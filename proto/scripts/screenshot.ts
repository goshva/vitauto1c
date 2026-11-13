import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Снимок экрана АРМ в трёх состояниях: список, отметка, после перехода.
// Нужен, чтобы глазами проверить то, что тесты проверяют утверждениями:
// тест «кнопка есть» проходит и на нечитаемой вёрстке.

const PORT = Number(process.env.PROTO_PORT ?? 18192);
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

// Ждём готовности: опрашиваем health, а не спим фиксированное время.
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`${BASE}/health`);
    if (r.ok) break;
  } catch {
    // сервер ещё поднимается
  }
  await new Promise((r) => setTimeout(r, 250));
}

execFileSync(bunPath(), ['run', 'db/seed.ts', '--all'], { cwd: process.cwd(), stdio: 'ignore' });

const browser = await chromium.launch({ args: ['--no-proxy-server'], ...(useSystemChrome ? { channel: 'chrome' } : {}) });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

await page.goto(`${BASE}/lines`);
await page.getByTestId('import-panel').locator('summary').click();
await page.getByTestId('import-name').fill('Колодки тормозные передние');
await page.getByTestId('import-article').fill('BRK-FR-001');
await page.getByTestId('import-qty').fill('2');
await page.getByTestId('import-client-number').fill('СНИМОК-1');
await page.getByTestId('import-submit').click();
await page.getByTestId('lines-table').waitFor();
await page.screenshot({ path: 'logs/screen-1-list.png', fullPage: true });

const row = page.getByTestId('lines-body').locator('tr').filter({ hasText: 'СНИМОК-1' });
const id = (await row.getAttribute('data-id'))!;
await page.getByTestId(`mark-${id}`).click();
await page.getByTestId('mark-count').waitFor();
await page.screenshot({ path: 'logs/screen-2-marked.png', fullPage: true });

await page.getByTestId('chain-job').click();
await page.getByTestId(`status-${id}`).waitFor();
await page.screenshot({ path: 'logs/screen-3-after-transition.png', fullPage: true });

await browser.close();
server.kill();

console.log('снимки: logs/screen-1-list.png, screen-2-marked.png, screen-3-after-transition.png');
