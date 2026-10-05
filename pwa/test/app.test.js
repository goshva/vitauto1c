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

  it('консоль: smoke всех операций чтения', async ({ skip }) => {
    if (!reachable) skip();
    await useSessionStore().login('arm.manager', '1');
    const w = await mountAt('/console');
    expect(w.findAll('.op')).toHaveLength(29);
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
