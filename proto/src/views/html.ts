import { icon } from './icons.ts';

// Каркас HTML и экранирование.
//
// HTMX выбран заказчиком (решение Q2): сервер отдаёт готовые фрагменты, браузер
// их подставляет. Никакого сборщика, никакого состояния на клиенте — то, что
// нельзя собрать в 200 строк на сервере, не должно попадать в АРМ.
//
// Экранирование обязательно: данные приходят из заявок клиентов, где встречаются
// кавычки, угловые скобки и амперсанды. Без экранирования список ломается на первой
// же строке с `<` — в legacy это был реальный дефект.
//
// ОБОЛОЧКА перенесена из legacy (`pwa/src/App.vue` + `style.css`): боковая панель
// с брендом, пунктами и профилем, верхняя панель с заголовком, область контента.
// На телефоне панель превращается в нижнюю навигацию — то же правило `900px`, что
// и в legacy. Панель сворачивается кнопкой, состояние переживает перезагрузку.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const esc = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Пустое значение показываем прочерком, а не пустой ячейкой: пустота читается как «нет данных». */
export const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? '<span class="empty">—</span>' : esc(s);
};

/** Пункты боковой панели. `key` совпадает с тем, что экран передаёт в `active`. */
const NAV: { key: string; href: string; title: string; icon: string; testId: string }[] = [
  { key: 'dashboard', href: '/', title: 'Сводка', icon: 'summary', testId: 'nav-dashboard' },
  { key: 'lines', href: '/lines', title: 'Строки', icon: 'lines', testId: 'nav-lines' },
  { key: 'supply', href: '/supply', title: 'Снабжение', icon: 'supply', testId: 'nav-supply' },
  { key: 'documents', href: '/documents/returns', title: 'Документы', icon: 'documents', testId: 'nav-documents' },
  { key: 'fleet', href: '/fleet', title: 'Автопарк', icon: 'fleet', testId: 'nav-fleet' },
  { key: 'stock', href: '/stock', title: 'Склад', icon: 'stock', testId: 'nav-stock' },
  { key: 'unidentified', href: '/unidentified', title: 'Неопознанные', icon: 'unidentified', testId: 'nav-unidentified' },
  { key: 'invoices', href: '/invoices', title: 'Счета', icon: 'invoices', testId: 'nav-invoices' },
  { key: 'processes', href: '/processes', title: 'Карта процессов', icon: 'processes', testId: 'nav-process' },
];

export interface LayoutProps {
  title: string;
  /** Содержимое страницы. */
  body: string;
  /** Идентификатор страницы для Playwright. */
  testId: string;
  /** Ключ раздела для подсветки пункта меню. Без него панель просто без подсветки. */
  active?: string;
  /** Кто работает. В прототипе роль приходит заголовком `X-Role`. */
  role?: string;
}

const ROLE_TITLES: Record<string, string> = {
  admin: 'Администратор',
  municipality: 'Муниципалитет',
  manager: 'Менеджер',
  mechanic: 'Механик',
  storekeeper: 'Кладовщик',
};

/**
 * Сворачивание панели и тема.
 *
 * Оба состояния применяются ДО отрисовки: скрипт стоит в `<head>`, до `<body>`.
 * Иначе при тёмной теме страница мигает белым, а свёрнутая панель разворачивается
 * на мгновение при каждой загрузке — и это заметно на каждом переходе.
 *
 * В `localStorage` пишем и читаем в `try`: в приватном режиме браузера хранилище
 * может быть недоступно, и падение скрипта оставило бы страницу без оболочки.
 */
const UI_SCRIPT = `(function(){try{
var t=localStorage.getItem('arm.theme');if(t)document.documentElement.setAttribute('data-theme',t);
var n=localStorage.getItem('arm.nav');document.documentElement.setAttribute('data-nav',n||'expanded');
}catch(e){document.documentElement.setAttribute('data-nav','expanded');}})();
function armTheme(){var r=document.documentElement;
var now=r.getAttribute('data-theme')||'';
var next=now==='dark'?'light':now==='light'?'':'dark';
if(next)r.setAttribute('data-theme',next);else r.removeAttribute('data-theme');
try{localStorage.setItem('arm.theme',next||'');}catch(e){}}
function armNav(){var r=document.documentElement;
var collapsed=r.getAttribute('data-nav')==='collapsed';
var next=collapsed?'expanded':'collapsed';
r.setAttribute('data-nav',next);
var b=document.getElementById('nav-toggle');
if(b){b.setAttribute('aria-expanded',String(!(next==='collapsed')));
b.setAttribute('title',collapsed?'Свернуть меню':'Развернуть меню');
b.setAttribute('aria-label',collapsed?'Свернуть меню':'Развернуть меню');}
try{localStorage.setItem('arm.nav',next);}catch(e){}}`;

export function layout({ title, body, testId, active, role }: LayoutProps): string {
  const who = role ?? 'admin';
  const whoTitle = ROLE_TITLES[who] ?? who;

  // `title` и `aria-label` стоят ВСЕГДА, а не только при свёрнутой панели, как в
  // legacy. Причина: разметку рисует сервер и про состояние панели не знает.
  // Подсказка у подписанного пункта безвредна, а безымянный пункт при свёрнутой
  // панели — дефект доступности.
  const items = NAV.map((n) => `<a href="${n.href}" data-testid="${n.testId}"
      title="${esc(n.title)}" aria-label="${esc(n.title)}"${
    n.key === active ? ' class="active"' : ''}>
      <span class="pill">${icon(n.icon)}</span><span class="label">${esc(n.title)}</span>
    </a>`).join('\n    ');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <script>${UI_SCRIPT}</script>
  <link rel="stylesheet" href="/static/app.css">
  <script src="/static/htmx.min.js" defer></script>
</head>
<body data-testid="${esc(testId)}">
<div class="app">
  <nav class="navbar" aria-label="Разделы">
    <div class="brand"><span class="logo">А</span><span class="label">АРМ</span></div>
    <button type="button" class="nav-toggle" id="nav-toggle" onclick="armNav()"
      data-testid="nav-toggle" aria-expanded="true" title="Свернуть меню" aria-label="Свернуть меню">
      <span class="pill">${icon('collapse')}</span><span class="label">Свернуть</span>
    </button>
    ${items}
    <div class="spacer"></div>
    <button type="button" onclick="armTheme()" data-testid="theme-toggle"
      title="Сменить тему" aria-label="Сменить тему">
      <span class="pill">${icon('theme')}</span><span class="label">Тема</span>
    </button>
    <div class="who" data-testid="user-menu">
      <span class="who-icon">${icon('user')}</span>
      <div class="who-text"><b>${esc(whoTitle)}</b><span class="muted">${esc(who)}</span></div>
    </div>
  </nav>

  <div class="content">
    <header class="appbar">
      <div class="title">${esc(title)}</div>
    </header>
    <main class="main">
      <div class="page">
${body}
      </div>
    </main>
  </div>
</div>
</body>
</html>`;
}
