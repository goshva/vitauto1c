import { esc } from './html.ts';
import { icon } from './icons.ts';

// ПУНКТЫ БОКОВОЙ ПАНЕЛИ И ИХ ПОСТРОЕНИЕ.
//
// Вынесено из `html.ts` по размеру, но разделение вышло по смыслу: там СБОРКА СТРАНИЦЫ
// (шапка, содержимое, скрипт), здесь ПЕРЕЧЕНЬ РАЗДЕЛОВ и правило, кому какой доступен.
//
// ЭТО ЕДИНСТВЕННОЕ МЕСТО, ГДЕ РАЗДЕЛЫ ПЕРЕЧИСЛЕНЫ. Раньше список был один, но правило
// доступа к нему не было привязано вовсе, и проверить его тестом было нечем.

/**
 * Пункты панели.
 *
 * `roles` — КОМУ ПУНКТ ДОСТУПЕН. Пусто — доступен всем.
 *
 * ЗАЧЕМ ЭТО ЗДЕСЬ. Проверка вкладок запросом показала: из девяти пунктов ограничен ОДИН —
 * «Сводка», и та закрыта только администратору. Остальные восемь открыты любой роли, и
 * вкладка ведёт на экран, который её пустит. Ограничивать их «на глаз» нельзя: правила
 * доступа к ЭКРАНАМ в эталоне index.html нет вовсе — там про права на КОЛОНКИ.
 *
 * Поэтому список описывает ТО, ЧТО ЕСТЬ: единственное известное правило. Остальное —
 * открытый вопрос к заказчику, и он записан в `docs/access-matrix.md`.
 */
export const NAV: {
  key: string; href: string; title: string; icon: string; testId: string;
  roles?: readonly string[];
}[] = [
  { key: 'dashboard', href: '/', title: 'Сводка', icon: 'summary', testId: 'nav-dashboard',
    roles: ['admin'] },
  { key: 'lines', href: '/lines', title: 'Строки', icon: 'lines', testId: 'nav-lines' },
  { key: 'supply', href: '/supply', title: 'Снабжение', icon: 'supply', testId: 'nav-supply' },
  { key: 'documents', href: '/documents/returns', title: 'Документы', icon: 'documents',
    testId: 'nav-documents' },
  { key: 'fleet', href: '/fleet', title: 'Автопарк', icon: 'fleet', testId: 'nav-fleet' },
  { key: 'stock', href: '/stock', title: 'Склад', icon: 'stock', testId: 'nav-stock' },
  { key: 'unidentified', href: '/unidentified', title: 'Неопознанные', icon: 'unidentified',
    testId: 'nav-unidentified' },
  { key: 'invoices', href: '/invoices', title: 'Счета', icon: 'invoices', testId: 'nav-invoices' },
  { key: 'processes', href: '/processes', title: 'Карта процессов', icon: 'processes',
    testId: 'nav-process' },
];

/**
 * Разметка пунктов панели.
 *
 * ПУНКТ, ДОСТУПНЫЙ НЕ ВСЕМ, ПОМЕЧАЕТСЯ СПИСКОМ РОЛЕЙ (`data-role-only`). Скрывает его
 * скрипт — по той же причине, что и роль в меню: серверная разметка роли не знает, а скрипт
 * спрашивает `/api/whoami` и получает её точно.
 *
 * ПОМЕТКА ИМЕННО СПИСКОМ, А НЕ ФЛАГОМ «скрыть»: по ней видно, КОМУ пункт положен, и это
 * проверяется тестом без браузера.
 *
 * Подсказка у подписанного пункта безвредна, а безымянный пункт при свёрнутой панели —
 * дефект доступности.
 */
export function navItems(active?: string): string {
  return NAV.map((n) => `<a href="${n.href}" data-testid="${n.testId}"
      title="${esc(n.title)}" aria-label="${esc(n.title)}"${
    n.roles ? ` data-role-only="${esc(n.roles.join(' '))}"` : ''}${
    n.key === active ? ' class="active"' : ''}>
      <span class="pill">${icon(n.icon)}</span><span class="label">${esc(n.title)}</span>
    </a>`).join('\n    ');
}
