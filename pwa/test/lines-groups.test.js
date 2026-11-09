// TODO (docs/TODO.md, п. 24): файл не парсится — второй it(...) не закрыт, третий вложен в него,
// поэтому vitest падает с «invalid JS syntax». Закрыть блок и вернуть проверку снятия фильтра по «×».
// Вложенные строки заказа в таблице: по умолчанию раскрыты и сворачиваются кликом по шапке заказа.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const { mockLines } = vi.hoisted(() => {
  const order = { id: 'o1', number: 'ЗК-004', date: '2026-11-02', posted: true };
  return {
    mockLines: [
      { id: 'l1', status: 'prepared', operation: 'sale', customerOrder: order, customer: { name: 'АвтоДеталь Сервис' }, factName: 'Фильтр масляный', marked: false, saleSum: 100 },
      { id: 'l2', status: 'draft', operation: 'sale', customerOrder: order, customer: { name: 'АвтоДеталь Сервис' }, factName: 'Свеча зажигания', marked: false, saleSum: 200 }
    ]
  };
});

vi.mock('../src/api', () => ({
  api: vi.fn(async (method, path) => {
    if (path === '/matrix') {
      return {
        status: 200,
        data: {
          role: 'admin',
          statuses: ['draft', 'prepared'],
          columns: [{ id: 'customer', field: 'Покупатель', code: 'В6', title: 'Заказчик', writable: true, rights: '++' }]
        },
        headers: new Headers({ ETag: 'w/"t"' })
      };
    }
    return { data: {}, status: 200, headers: new Headers() };
  }),
  get: vi.fn(async path => {
    if (path === '/lines') return { items: mockLines, nextCursor: null };
    if (path === '/selection') return { count: 0, quantity: 0, saleSum: 0, costSum: 0 };
    return {};
  }),
  post: vi.fn(async () => ({}))
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { view: 'sales' }, query: {} }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() })
}));

import LinesView from '../src/views/LinesView.vue';
import { useSessionStore } from '../src/stores/session';
import { useMatrixStore } from '../src/stores/matrix';
import { useLinesStore } from '../src/stores/lines';
import { useUiStore } from '../src/stores/ui';

const stubs = {
  RefPicker: true, FieldSettings: true, AppModal: true, JobDialog: true,
  LineCard: true, LineSheet: true, CellPicker: true, AppIcon: true
};

describe('строки деталей в заказе (таблица)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="appbar-actions"></div>';
    const pinia = createPinia();
    setActivePinia(pinia);
    useSessionStore().$patch({ token: 't', user: { role: 'admin', userName: 'Админ' } });
    useMatrixStore().$patch({ role: 'admin', statuses: [], columns: [] });
    useLinesStore().$patch({ view: 'sales', filters: { ...useLinesStore().filters, groupByCustomerOrder: true } });
    useUiStore().$patch({ layout: 'table', wide: true });
  });

  it('по умолчанию показывает строки под шапкой заказа и сворачивает по клику', async () => {
    const wrapper = mount(LinesView, { global: { stubs } });
    await flushPromises();

    // 1 шапка заказа + 2 строки деталей
    expect(wrapper.findAll('tbody tr').length).toBe(3);
    expect(wrapper.text()).toContain('ЗК-004');

    await wrapper.find('tbody tr').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('tbody tr').length).toBe(1);

    await wrapper.find('tbody tr').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('tbody tr').length).toBe(3);
  });

  it('фильтр по значению ячейки показывает в бейдже число найденных строк', async () => {
    const wrapper = mount(LinesView, { global: { stubs } });
    await flushPromises();

    // колонка «Заказчик» — третья ячейка строки деталей (после отметки и статуса)
    const lineRow = wrapper.findAll('tbody tr')[1];
    const customerCell = lineRow.findAll('td')[2];
    expect(customerCell.text()).toContain('АвтоДеталь Сервис');
    await customerCell.trigger('dblclick');
    await flushPromises();

    const filterBtn = document.querySelector('#appbar-actions button[aria-label^="Фильтры"]');
    expect(filterBtn).toBeTruthy();
    expect(filterBtn.getAttribute('aria-label')).toBe('Фильтры, отфильтровано 2 из 2 строк');
    const badge = document.querySelector('#appbar-actions .icon-badge');
    expect(badge && badge.textContent).toBe('2');
    expect(wrapper.text()).toContain('Заказчик: АвтоДеталь Сервис');

    // «×» на чипе снимает фильтр — бейдж исчезает
  it('двойной клик по статусу фильтрует, ярлык карточки — отдельно от чекбокса', async () => {
    const wrapper = mount(LinesView, { global: { stubs } });
    await flushPromises();

    const lineRow = wrapper.findAll('tbody tr')[1];
    const firstCell = lineRow.findAll('td')[0];
    // ярлык редактирования стоит перед чекбоксом выбора
    expect(firstCell.find('button[aria-label="Открыть карточку строки"]').exists()).toBe(true);
    expect(firstCell.find('input[type="checkbox"]').exists()).toBe(true);
    const cells = firstCell.element.children[0].children;
    expect(cells[0].tagName).toBe('BUTTON');
    expect(cells[1].tagName).toBe('INPUT');

    // статус — не кнопка: одиночный клик карточку не открывает, двойной фильтрует
    const statusCell = lineRow.findAll('td')[1];
    expect(statusCell.find('button').exists()).toBe(false);
    await statusCell.find('span.chip').trigger('dblclick');
    await flushPromises();
    expect(wrapper.text()).toContain('Статус: prepared');
    expect(wrapper.findAll('tbody tr').length).toBe(2);
  });
});
