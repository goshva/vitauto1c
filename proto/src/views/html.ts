import { icon } from './icons.ts';
import { UI_SCRIPT } from './ui-script.ts';

// Каркас HTML и экранирование.
//
// HTMX выбран заказчиком (решение Q2): сервер отдаёт готовые фрагменты, браузер
// их подставляет. Никакого сборщика, никакого состояния на клиенте — то, что
// нельзя собрать в 200 строк на сервере, не должно попадать в АРМ.
//
// Экранирование обязательно: данные приходят из заявок клиентов, где встречаются
// кавычки, угловые скобки и амперсанды. Без экранирования список ломается на первой
// же строке с "<" — в legacy это был реальный дефект.
//
// ОБОЛОЧКА перенесена из legacy ("pwa/src/App.vue" + "style.css"): боковая панель
// с брендом, пунктами и профилем, верхняя панель с заголовком, область контента.
// На телефоне панель превращается в нижнюю навигацию — то же правило "900px", что
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

/** Пункты боковой панели. "key" совпадает с тем, что экран передаёт в "active". */
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
  /** Кто работает. В прототипе роль приходит заголовком "X-Role". */
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
 * Оба состояния применяются ДО отрисовки: скрипт стоит в "<head>", до "<body>".
 * Иначе при тёмной теме страница мигает белым, а свёрнутая панель разворачивается
 * на мгновение при каждой загрузке — и это заметно на каждом переходе.
 *
 * В "localStorage" пишем и читаем в "try": в приватном режиме браузера хранилище
 * может быть недоступно, и падение скрипта оставило бы страницу без оболочки.
 */

// МЕНЮ ПОЛЬЗОВАТЕЛЯ: имя роли, выход и смена роли.
//
// РАНЬШЕ ЗДЕСЬ БЫЛА ТОЛЬКО НАДПИСЬ, и ВЫЙТИ БЫЛО НЕОТКУДА: маршрут "/logout" в коде был,
// а добраться до него из интерфейса — нет. Роль в прототипе меняют часто (её и показывают
// заказчику), и каждый раз править адресную строку руками — не работа.
//
// РАСКРЫТИЕ СДЕЛАНО НА "details", БЕЗ СКРИПТА: меню должно открываться и там, где скрипт
// ещё не загрузился, и это надёжнее обработчика на клиенте. Закрывается повторным нажатием
// и переходом по ссылке внутри.
export function layout({ title, body, testId, active, role }: LayoutProps): string {
  // РОЛЬ БЕРЁТСЯ ИЗ СЕССИИ, А НЕ ИЗ ПАРАМЕТРА СТРАНИЦЫ.
  //
  // Раньше здесь стояло "role ?? 'admin'" — и это была ЛОЖЬ НА ЭКРАНЕ. Параметр "role"
  // передают не все страницы: из 23 вызовов "layout" его не передавал НИ ОДИН, и меню
  // показывало «Администратор» независимо от того, кто вошёл. Нашлось это тестом на смену
  // роли: вошли менеджером, а в меню остался администратор.
  //
  // ПРОБЛЕМА БЫЛА В ИСТОЧНИКЕ, А НЕ В ЗНАЧЕНИИ. Роль лежит в сессии, и сервер её знает, —
  // но "layout" чистый и запроса не видит. Протянуть её через 23 вызова значило бы
  // повторить одно и то же в 23 местах и однажды снова забыть.
  //
  // Поэтому роль ПОДСТАВЛЯЕТСЯ ОДНИМ МЕСТОМ: разметка отдаёт пустое поле с пометкой, а
  // скрипт страницы спрашивает "/api/whoami" и заполняет его. Одно место — один ответ.
  //
  // БЕЗ СКРИПТА МЕНЮ НЕ ВРЁТ: вместо чужой роли там стоит «…» — видно, что значение ещё не
  // получено, а не что вошёл администратор.
  const who = role ?? null;
  const whoTitle = who ? (ROLE_TITLES[who] ?? who) : '…';

  // "title" и "aria-label" стоят ВСЕГДА, а не только при свёрнутой панели, как в
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
    <button type="button" class="who" data-testid="user-menu"
      onclick="armMenu()" aria-haspopup="dialog" title="Пользователь: выход и смена роли">
      <span class="who-icon">${icon('user')}</span>
      <span class="who-text"><b data-testid="user-menu-role-name">${esc(whoTitle)}</b><span class="muted" data-testid="user-menu-role-code">${esc(who ?? '')}</span></span>
    </button>
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

${/*
  МОДАЛЬНОЕ ОКНО ПОЛЬЗОВАТЕЛЯ — В КОНЦЕ СТРАНИЦЫ, А НЕ В ШАПКЕ.
  
  Здесь был раскрывающийся список в углу шапки, и заказчик его не видел: он появлялся сбоку,
  в узкой колонке навигации, и выход в нём приходилось искать.
  
  Взят НАТИВНЫЙ `<dialog>` С `showModal()`. Он даёт сразу всё, что нужно: окно ПО ЦЕНТРУ
  экрана, подложку, закрытие по ESC и — главное — TOP LAYER: окно рисуется поверх всей
  страницы независимо от того, где лежит в разметке.
  
  ПОЧЕМУ ЭТО ВАЖНО ЗДЕСЬ. У шапки есть `backdrop-filter`, а он создаёт containing block для
  потомков с `position: fixed`. Обычное модальное окно внутри шапки встало бы НЕ по центру
  экрана, а по центру шапки, — и это выяснилось бы только на живом экране. Top layer от
  этого не зависит вовсе.
  
  ОКНО ЛЕЖИТ В КОНЦЕ СТРАНИЦЫ, а не рядом с кнопкой: так его не задевают стили шапки, и
  видно, что это отдельный слой, а не часть навигации.
*/''}
<dialog id="user-modal" class="modal" data-testid="user-modal">
  <h2 data-testid="user-modal-title">Пользователь</h2>
  <p class="hint" data-testid="user-menu-role">Вы вошли как
    <b data-testid="user-menu-role-name">${esc(whoTitle)}</b>
    (<span data-testid="user-menu-role-code">${esc(who ?? '')}</span>)</p>

  <form method="post" action="/logout" data-testid="logout-form">
    <button type="submit" data-testid="logout" class="modal-primary">Выйти</button>
  </form>
  <a href="/login" data-testid="switch-role" class="modal-secondary">Войти под другой ролью</a>

  <form method="dialog" class="modal-close">
    <button type="submit" data-testid="user-modal-close">Закрыть</button>
  </form>
</dialog>
</body>
</html>`;
}
