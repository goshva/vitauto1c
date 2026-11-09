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
    if (path === '/matrix') return { status: 200, data: { role: 'admin', statuses: [], columns: [] }, headers: new Headers({ ETag: 'w/"t"' }) };
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
});
