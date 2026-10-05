// Интеграционные тесты PWA против HTTP-сервиса 1С (Арм_API, ARM v2.9): реальные компоненты, Pinia, роутер, без моков.
// Нужна запущенная публикация (tools/arm-api-1c) и тестовые пользователи arm.manager / arm.supply с паролем 1.
//   ARM_API_URL=http://127.0.0.1:8090/vitauto/hs/api/arm/v1 npm test
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useSessionStore } from '../src/stores/session';
import { useMatrixStore } from '../src/stores/matrix';
import { useLinesStore } from '../src/stores/lines';
import { useLogStore } from '../src/stores/log';

const BASE = process.env.ARM_API_BASE;

async function until(cond, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    await flushPromises();
    const v = cond();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('не дождались: ' + cond.toString());
    await new Promise(r => setTimeout(r, 100));
  }
}

let reachable = true;
beforeAll(async () => {
  try {
    const r = await fetch(location.origin + BASE + '/session');
    reachable = r.status === 401;
  } catch {
    reachable = false;
  }
});

let pinia;
beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().setBaseUrl(BASE);
});

// Роутер — синглтон модуля и выполняет guard'ы в контексте первого приложения, куда установлен:
// для каждого теста свежие модули App/router (хранилища Pinia общие по id, состояние — в тестовом pinia).
let router;
async function mountAt(path) {
  vi.resetModules();
  const { default: App } = await import('../src/App.vue');
  router = (await import('../src/router')).default;
  const wrapper = mount(App, { global: { plugins: [pinia, router] }, attachTo: document.body });
  await router.push(path);
  await router.isReady();
  await flushPromises();
  return wrapper;
}

describe('матрица: права ячейки', () => {
  it('+, c и . по статусу строки', () => {
    const m = useMatrixStore();
    m.statuses = ['new', 'in_work'];
    const col = { writable: true, rights: '+c' };
    expect(m.denyReason(col, { status: 'new' }, 'Я')).toBeNull();
    expect(m.denyReason(col, { status: 'in_work', markedBy: 'Я' }, 'Я')).toBeNull();
    expect(m.denyReason(col, { status: 'in_work', markedBy: 'Другой' }, 'Я')).toMatch(/автор/);
    expect(m.denyReason({ writable: true, rights: '..' }, { status: 'new' }, 'Я')).toMatch(/матрица/);
    expect(m.denyReason({ writable: false, rights: '++' }, { status: 'new' }, 'Я')).toMatch(/только для чтения/);
    expect(m.denyReason(col, { status: 'new', locked: true }, 'Я')).toMatch(/заблокирована/);
  });
});

describe('PWA против 1С', () => {
  it('без входа — экран входа, неверный пароль — ошибка', async ({ skip }) => {
    if (!reachable) skip();
    const w = await mountAt('/lines/sales');
    expect(router.currentRoute.value.name).toBe('login');
    await w.find('input[autocomplete=username]').setValue('arm.manager');
    await w.find('input[autocomplete=current-password]').setValue('неверный');
    await w.find('form').trigger('submit');
    await until(() => w.find('.err').exists());
    expect(w.find('.err').text()).toMatch(/401 unauthorized/);
    w.unmount();
  });

  it('менеджер: вход, продажи по матрице, PATCH ячейки, отметка и итоги', async ({ skip }) => {
    if (!reachable) skip();
    const w = await mountAt('/login');
    await w.find('input[autocomplete=username]').setValue('arm.manager');
    await w.find('input[autocomplete=current-password]').setValue('1');
    await w.find('form').trigger('submit');
    await until(() => router.currentRoute.value.name === 'lines');
    expect(router.currentRoute.value.params.view).toBe('sales');
    expect(useSessionStore().role).toBe('manager');

    const lines = useLinesStore();
    await until(() => lines.items.length > 0 && w.findAll('tbody tr:not(.group)').length > 0);
    expect(useMatrixStore().columns).toHaveLength(50);
    expect(useMatrixStore().statuses).toHaveLength(15);
    expect(w.findAll('tbody tr.group').length).toBeGreaterThan(0);
    await until(() => w.find('.totals').exists());
    expect(w.find('.totals').text()).toMatch(/Отмечено/);

    // правка комментария: двойной клик по редактируемой ячейке → input → Enter → PATCH
    const headers = w.findAll('thead th').map(th => th.text());
    const col = headers.findIndex(t => t.includes('омментар'));
    expect(col).toBeGreaterThan(0);
    const row = w.findAll('tbody tr:not(.group)').find(tr => tr.findAll('td')[col].classes('editable'));
    expect(row, 'есть строка с редактируемым комментарием').toBeTruthy();
    const id = lines.items.find(l => !l.deleted && useMatrixStore().denyReason(useMatrixStore().byField['КомментарийКСтроке'], l, useSessionStore().user.userName) === null).id;
    lines.current = id;
    await flushPromises();
    const target = w.findAll('tbody tr:not(.group)').find(tr => tr.classes('current'));
    const cell = target.findAll('td')[col];
    await cell.trigger('dblclick');
    await flushPromises();
    const stamp = 'PWA-тест ' + Date.now();
    await cell.find('input').setValue(stamp);
    await cell.find('input').trigger('keydown', { key: 'Enter' });
    await until(() => lines.items.find(l => l.id === id).comment === stamp);
    expect(useLogStore().entries.some(e => e.method === 'PATCH' && e.status === 200)).toBe(true);

    // отметка строки → итоги выделения
    const before = lines.totals.count;
    const box = w.findAll('tbody tr:not(.group)').find(tr => tr.classes('current')).find('td.sticky-1 input');
    await box.trigger('click');
    await until(() => lines.totals.count !== before);
    await w.findAll('tbody tr:not(.group)').find(tr => tr.classes('current')).find('td.sticky-1 input').trigger('click');
    await until(() => lines.totals.count === before);

    // нельзя: снабжение для менеджера → роутер возвращает на продажи
    await router.push('/lines/supply');
    await flushPromises();
    expect(router.currentRoute.value.params.view).toBe('sales');
    w.unmount();
  });

  it('колонки: этап процесса, скрытие поля, отдельно по спискам, сохранение', async ({ skip }) => {
    if (!reachable) skip();
    const { STAGES } = await import('../src/stores/columns');
    await useSessionStore().login('arm.manager', '1');
    const w = await mountAt('/lines/sales');
    const lines = useLinesStore();
    await until(() => lines.items.length > 0 && w.findAll('thead th').length > 2);
    const heads = () => w.findAll('thead th').slice(2).map(th => th.text());
    const compact = heads();
    expect(compact.length).toBeGreaterThan(10);

    // чекбокс открывает настройку
    await w.findAll('button').find(b => b.text().startsWith('Колонки')).trigger('click');
    await flushPromises();
    const modal = () => w.find('.modal');
    expect(modal().text()).toMatch(/Этап процесса/);

    // этап M4 «Заказ поставщику»: только его колонки
    const m4 = STAGES.find(s => s.id === 'M4');
    await modal().find('select').setValue('M4');
    await flushPromises();
    const matrix = useMatrixStore();
    const expected = matrix.columns.filter(c => m4.columns.includes(c.id) && !['cell_select', 'line_status'].includes(c.id))
      .map(c => c.code + c.title);
    expect(heads()).toEqual(expected);

    // скрыть одну колонку галочкой
    const victim = matrix.columns.find(c => c.id === 'supplier');
    const box = modal().findAll('.list label').find(l => l.text().includes(victim.title));
    await box.find('input').trigger('change');
    await flushPromises();
    expect(heads()).not.toContain(victim.code + victim.title);
    expect(heads().length).toBe(expected.length - 1);

    // «скрывать пустые» не увеличивает набор
    const before = heads().length;
    await modal().findAll('input[type=checkbox]')[0].setValue(true);
    await flushPromises();
    expect(heads().length).toBeLessThanOrEqual(before);
    await modal().findAll('input[type=checkbox]')[0].setValue(false);

    // настройка хранится по роли и списку
    const saved = JSON.parse(localStorage.getItem('arm.columns.v2'));
    expect(saved['manager.sales'].mode).toBe('custom');
    expect(saved['manager.purchases']).toBeUndefined();
    await w.findAll('.modal button').find(b => b.text() === 'Закрыть').trigger('click');

    await router.push('/lines/purchases');
    await until(() => router.currentRoute.value.params.view === 'purchases' && !lines.loading);
    await until(() => heads().length > 0 || lines.items.length === 0);
    // в закупках своя настройка — по умолчанию «основные», как было в продажах до изменений
    expect(heads()).toEqual(compact);

    await router.push('/lines/sales');
    await until(() => router.currentRoute.value.params.view === 'sales' && !lines.loading);
    expect(heads()).toEqual(expected.filter(h => h !== victim.code + victim.title));
    w.unmount();
  });

  it('переходы процессов: кнопки по роли, без отметок — 409 nothing_marked', async ({ skip }) => {
    if (!reachable) skip();
    const { useToastStore } = await import('../src/stores/toast');
    const names = w => w.findAll('.toolbar').find(t => t.text().startsWith('Отмеченные строки')).findAll('button').map(b => b.text());

    await useSessionStore().login('arm.storekeeper', '1');
    let w = await mountAt('/lines/sales');
    await until(() => w.findAll('button').some(b => b.text() === 'Собрано'));
    expect(names(w)).toEqual(['Собрано', 'Принять по УПД', 'Возврат', 'Закрыть']);
    w.unmount();

    await useSessionStore().login('arm.manager', '1');
    w = await mountAt('/lines/sales');
    await until(() => w.findAll('button').some(b => b.text() === 'Зарезервировать'));
    expect(names(w)).toEqual(['Зарезервировать', 'На комплектацию', 'Собрано', 'Самовывоз', 'Возврат', 'Закрыть']);
    // свои отметки снять, затем «Зарезервировать» без отмеченных строк
    const lines = useLinesStore();
    for (const l of [...lines.items]) if (l.marked && l.markedBy === useSessionStore().user.userName) await lines.toggleMark(l);
    await w.findAll('button').find(b => b.text() === 'Зарезервировать').trigger('click');
    await until(() => useToastStore().items.some(t => /nothing_marked/.test(t.text)));
    expect(useLogStore().entries.some(e => e.method === 'POST' && e.url.endsWith('/lines/transition') && e.status === 409)).toBe(true);
    w.unmount();
  });

  it('консоль: smoke всех операций чтения', async ({ skip }) => {
    if (!reachable) skip();
    await useSessionStore().login('arm.manager', '1');
    const w = await mountAt('/console');
    expect(w.findAll('.op')).toHaveLength(30);
    await w.findAll('button').find(b => b.text() === 'Запустить').trigger('click');
    const text = await until(() => (w.text().match(/успешно (\d+) из (\d+)/) || null));
    await until(() => !w.findAll('.chip').some(c => c.text() === '…'), 60000);
    const [, ok, total] = w.text().match(/успешно (\d+) из (\d+)/);
    // GET /jobs/{id} без задания в контексте не вызывается
    expect(Number(total)).toBe(13);
    expect(Number(ok)).toBeGreaterThanOrEqual(12);
    void text;
    w.unmount();
  });

  it('снабжение: только канбан, вкладки роли', async ({ skip }) => {
    if (!reachable) skip();
    await useSessionStore().login('arm.supply', '1');
    const w = await mountAt('/');
    await until(() => router.currentRoute.value.name === 'lines');
    expect(router.currentRoute.value.params.view).toBe('supply');
    expect(w.findAll('.topbar nav a').map(a => a.text())).toEqual(['Снабжение', 'Справочники', 'Матрица', 'Консоль', 'Журнал']);
    await until(() => w.findAll('button').some(b => b.text() === 'Оплачено'));
    w.unmount();
  });
});
