import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Проверка перенесённого дизайна по ВЫЧИСЛЕННЫМ стилям, а не по снимку:
// снимок этой моделью не читается, а свойства видно точно.

const PORT = 18198;
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
const checks: [string, boolean, string][] = [];

// --- ПК: боковая панель + верхняя панель + сетка ---
const pc = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await pc.goto(`${BASE}/lines`);

const layout = await pc.evaluate(() => {
  const app = document.querySelector('.app')!;
  const nav = document.querySelector('.navbar')!;
  const bar = document.querySelector('.appbar')!;
  const cs = getComputedStyle(app);
  const ns = getComputedStyle(nav);
  const bs = getComputedStyle(bar);
  return {
    grid: cs.display,
    columns: cs.gridTemplateColumns,
    navWidth: Math.round(nav.getBoundingClientRect().width),
    navHeight: Math.round(nav.getBoundingClientRect().height),
    navDirection: ns.flexDirection,
    navBorderRight: ns.borderRightWidth,
    barHeight: Math.round(bar.getBoundingClientRect().height),
    barTop: bs.position,
    title: document.querySelector('.appbar .title')?.textContent ?? '',
    brand: document.querySelector('.navbar .brand')?.textContent?.trim() ?? '',
    who: document.querySelector('.navbar .who-text b')?.textContent ?? '',
    iconCount: document.querySelectorAll('.navbar .pill svg').length,
  };
});

checks.push(['ПК: оболочка — сетка', layout.grid === 'grid', layout.grid]);
checks.push(['ПК: колонки панель+контент', layout.columns.startsWith('232px'), layout.columns]);
checks.push(['ПК: панель шириной 232', layout.navWidth === 232, `${layout.navWidth}px`]);
checks.push(['ПК: панель во всю высоту', layout.navHeight >= 890, `${layout.navHeight}px`]);
checks.push(['ПК: панель — колонка', layout.navDirection === 'column', layout.navDirection]);
checks.push(['ПК: панель с правой границей', layout.navBorderRight !== '0px', layout.navBorderRight]);
checks.push(['ПК: верхняя панель 56', layout.barHeight === 56, `${layout.barHeight}px`]);
checks.push(['ПК: верхняя панель липкая', layout.barTop === 'sticky', layout.barTop]);
checks.push(['ПК: заголовок в верхней панели', layout.title.length > 0, layout.title]);
checks.push(['ПК: бренд «АРМ»', layout.brand.includes('АРМ'), layout.brand]);
checks.push(['ПК: профиль в панели', layout.who.length > 0, layout.who]);
checks.push(['ПК: иконки в пунктах меню', layout.iconCount >= 8, String(layout.iconCount)]);

// --- Подсветка активного пункта ---
const active = await pc.evaluate(() => {
  const a = document.querySelector('.navbar a.active');
  return { href: a?.getAttribute('href') ?? '', bg: a ? getComputedStyle(a).backgroundColor : '' };
});
checks.push(['Подсветка активного пункта', active.href === '/lines', active.href]);
checks.push(['Активный пункт окрашен', active.bg !== 'rgba(0, 0, 0, 0)', active.bg]);

// --- Таблица: липкая шапка ---
const th = await pc.evaluate(() => {
  const el = document.querySelector('table th');
  return el ? getComputedStyle(el).position : 'нет таблицы';
});
checks.push(['Таблица: липкая шапка', th === 'sticky', th]);

// --- Тёмная тема меняет фон ---
const lightBg = await pc.evaluate(() => getComputedStyle(document.body).backgroundColor);
await pc.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await pc.waitForTimeout(100);
const darkBg = await pc.evaluate(() => getComputedStyle(document.body).backgroundColor);
checks.push(['Тёмная тема меняет фон', lightBg !== darkBg, `${lightBg} → ${darkBg}`]);

// --- Телефон: панель внизу ---
const phone = await browser.newPage({ viewport: { width: 420, height: 900 } });
await phone.goto(`${BASE}/lines`);
const mobile = await phone.evaluate(() => {
  const nav = document.querySelector('.navbar')!;
  const cs = getComputedStyle(nav);
  const r = nav.getBoundingClientRect();
  return {
    position: cs.position,
    bottom: Math.round(window.innerHeight - r.bottom),
    direction: cs.flexDirection,
    brandHidden: getComputedStyle(document.querySelector('.navbar .brand')!).display,
  };
});
checks.push(['Телефон: панель фиксирована', mobile.position === 'fixed', mobile.position]);
checks.push(['Телефон: панель внизу', Math.abs(mobile.bottom) <= 2, `${mobile.bottom}px`]);
checks.push(['Телефон: пункты в строку', mobile.direction === 'row', mobile.direction]);
checks.push(['Телефон: бренд скрыт', mobile.brandHidden === 'none', mobile.brandHidden]);

// --- Печать: навигация скрыта ---
await pc.goto(`${BASE}/lines`);
await pc.emulateMedia({ media: 'print' });
const printNav = await pc.evaluate(() => getComputedStyle(document.querySelector('.navbar')!).display);
checks.push(['Печать: навигация скрыта', printNav === 'none', printNav]);

await browser.close();
server.kill();

let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'НЕТ '} ${name.padEnd(34)} ${detail}`);
}
console.log(`\nпроверок: ${checks.length}, провалов: ${bad}`);
