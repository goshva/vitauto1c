// Пишущие операции PWA через OData (src/odata/backend.js) на живой тестовой базе — без экранов.
// Каждый тест возвращает данные как было (прямые запросы OData под arm.admin). Нужны seed (SEED-309-*) и
// тестовые пользователи (odata\pwa-test-users.ps1).   ODATA_URL=… npm test
import { describe, it, expect, beforeAll } from 'vitest';
import { createBackend } from '../src/odata/backend';
import { createClient, basicToken, guid, lit, EMPTY } from '../src/odata/client';
import { ARM, keyPath } from '../src/odata/mapping';

const BASE = location.origin + process.env.ARM_API_BASE;
let reachable = true;
const admin = createClient({ baseUrl: BASE, token: basicToken('arm.admin', '1') });

async function session(login) {
  const token = basicToken(login, '1');
  const user = (await createBackend({ baseUrl: BASE, session: { token, user: null } })('POST', '/session', { body: { login, password: '1' } })).data;
  const call = createBackend({ baseUrl: BASE, session: { token, user }, log: process.env.ODATA_LOG ? e => { if (e.status >= 400) console.log(login, e.status, e.method, e.url, JSON.stringify(e.response).slice(0, 300)); } : undefined });
  return { user, call: (m, p, o) => call(m, p, o).then(r => r.data) };
}
const raw = id => admin.list(ARM, { $filter: `ИдентификаторЗаписи eq ${lit(id)}` }).then(v => v[0]);
async function restore(rec, fields) {
  const cur = await raw(rec.ИдентификаторЗаписи);
  if (cur) await admin.patch(keyPath(cur), Object.fromEntries(fields.map(f => [f, rec[f]])));
}
const STATE = ['СтатусСтроки', 'ОтметкаСтроки', 'АвторСтроки_Key', 'ДатаОтправкиНаСборку', 'ДатаОтгрузки', 'НомерОтгрузки', 'Удаление'];

beforeAll(async () => {
  try { await admin.list(ARM, { $top: 1, $select: 'ИдентификаторЗаписи' }); } catch { reachable = false; }
});

describe('OData: пишущие операции PWA', () => {
  it('вход: роль из Арм_ПраваПользователей, ссылка на пользователя', async ({ skip }) => {
    if (!reachable) skip();
    const s = await session('arm.storekeeper');
    expect(s.user.role).toBe('storekeeper');
    expect(s.user.userRef).toMatch(/^[0-9a-f-]{36}$/);
    await expect(session('arm.nobody')).rejects.toMatchObject({ status: 401 });
  });

  it('переход «Зарезервировать»: отметка -> переход -> статус reserve, отметка снята', async ({ skip }) => {
    if (!reachable) skip();
    const m = await session('arm.manager');
    const rec = (await admin.list(ARM, { $filter: `ВидОперации eq 'Продажа' and СтатусСтроки eq 'Черновик' and Удаление eq false and АвторСтроки_Key eq ${guid(EMPTY)}`, $top: 1 }))[0];
    expect(rec, 'нужна строка продажи «Черновик» (seed)').toBeTruthy();
    try {
      const marked = await m.call('POST', `/lines/${rec.ИдентификаторЗаписи}/mark`);
      expect(marked.marked).toBe(true);
      expect(marked.markedBy).toBe('arm.manager');
      expect((await m.call('GET', '/selection', { query: { view: 'sales' } })).count).toBeGreaterThan(0);
      const r = await m.call('POST', '/lines/transition', { body: { view: 'sales', to: 'reserve' } });
      expect(r.processed).toBeGreaterThan(0);
      const after = await m.call('GET', `/lines/${rec.ИдентификаторЗаписи}`);
      expect(after.status).toBe('reserve');
      expect(after.marked).toBe(false);
    } finally { await restore(rec, STATE); }
  });

  it('PATCH по матрице: менеджер не может менять «Комментарий» в «Отгружено» (403), а в «Черновик» — может', async ({ skip }) => {
    if (!reachable) skip();
    const m = await session('arm.manager');
    const shipped = (await admin.list(ARM, { $filter: `ВидОперации eq 'Продажа' and СтатусСтроки eq 'Отгружено' and Удаление eq false`, $top: 1 }))[0];
    await expect(m.call('PATCH', `/lines/${shipped.ИдентификаторЗаписи}`, { body: { field: 'Количество', value: 1 } })).rejects.toMatchObject({ status: 403, code: 'matrix_denied' });
    const draft = (await admin.list(ARM, { $filter: `ВидОперации eq 'Продажа' and СтатусСтроки eq 'Черновик' and Удаление eq false`, $top: 1 }))[0];
    try {
      const l = await m.call('PATCH', `/lines/${draft.ИдентификаторЗаписи}`, { body: { field: 'Количество', value: 3 } });
      expect(l.quantity).toBe(3);
      expect((await raw(draft.ИдентификаторЗаписи)).Себестоимость).toBe(Math.round(3 * draft.СебестоимостьЕдиницы * 100) / 100);
    } finally { await restore(draft, ['Количество', 'Себестоимость']); }
  });

  it('закупка к строке продажи + канбан снабжения «Оплачено»: закупка и связанная продажа', async ({ skip }) => {
    if (!reachable) skip();
    const m = await session('arm.manager');
    // продажа идёт за закупкой, если у неё нет партии и количество совпадает (ИзменитьСтатусыВРегистреСнабжения)
    const sale = (await admin.list(ARM, { $filter: `ВидОперации eq 'Продажа' and СтатусСтроки eq 'Черновик' and Удаление eq false and Номенклатура_Key ne ${guid(EMPTY)} and Партия_Key eq ${guid(EMPTY)} and Количество gt 0`, $top: 1 }))[0];
    const created = await m.call('POST', '/lines', { body: { view: 'purchases', sourceLineId: sale.ИдентификаторЗаписи, nomenclatureIds: [sale.Номенклатура_Key] } });
    expect(created).toHaveLength(1);
    const pur = created[0];
    expect(pur.operation).toBe('purchase');
    expect(pur.linkKey).toBe(sale.КлючСвязиСтрок);
    try {
      // цепочка снабжения АРМ жёсткая (ИзменитьСтатусыВРегистреСнабжения): «Оплачено» — только из «Заказано»
      await admin.patch(keyPath(await raw(pur.id)), { СтатусСтроки: 'Заказано', Количество: sale.Количество });
      const s = await session('arm.supply');
      await s.call('POST', `/lines/${pur.id}/mark`);
      const r = await s.call('POST', '/supply/status', { body: { status: 'paid' } });
      expect(r.processed).toBe(1);
      expect((await s.call('GET', `/lines/${pur.id}`)).status).toBe('paid');
      expect((await m.call('GET', `/lines/${sale.ИдентификаторЗаписи}`)).status).toBe('paid');   // продажа идёт за закупкой
    } finally {
      const p = await raw(pur.id);
      if (p) await admin.del(keyPath(p));
      await restore(sale, STATE);
    }
  });

  it('новый заказ: создать, подобрать номенклатуру, карточка, удалить', async ({ skip }) => {
    if (!reachable) skip();
    const m = await session('arm.manager');
    const [cust] = await m.call('GET', '/directories/counterparties', { query: { q: 'АВД' } });
    const [nom] = await m.call('GET', '/directories/nomenclature', { query: { q: 'Антифриз' } });
    expect(cust && nom).toBeTruthy();
    const doc = await m.call('POST', '/sales/customer-orders', { body: { customerId: cust.id, clientOrderNumber: 'PWA-OData-тест', date: '2026-10-13' } });
    expect(doc.kind).toBe('customer_order');
    try {
      const added = await m.call('POST', '/lines', { body: { view: 'sales', customerOrderId: doc.id, nomenclatureIds: [nom.id] } });
      expect(added[0].nomenclature.name).toBe(nom.name);
      expect(added[0].customer.name).toBe(cust.name);
      const card = await m.call('GET', `/documents/customer_order/${doc.id}`);
      expect(card.counterparty.name).toBe(cust.name);
      const page = await m.call('GET', '/lines', { query: { view: 'sales', customerOrderId: doc.id } });
      expect(page.items).toHaveLength(1);
    } finally {
      await m.call('DELETE', `/sales/customer-orders/${doc.id}`);
    }
    expect((await admin.get(`Document_ЗаказПокупателя(${guid(doc.id)})`, { $select: 'DeletionMark' })).DeletionMark).toBe(true);
    expect(await admin.list(ARM, { $filter: `ДокументЗаказПокупателя_Key eq ${guid(doc.id)}` })).toHaveLength(0);
  });

  it('импорт листа покупателя: заказ со строками клиента, строки АРМ — обработчиком расширения', async ({ skip }) => {
    if (!reachable) skip();
    const m = await session('arm.manager');
    const [cust] = await m.call('GET', '/directories/counterparties', { query: { q: 'АВД' } });
    const doc = await m.call('POST', '/sales/imports', { body: { customerId: cust.id, rows: [
      { clientNumber: 'PWA-импорт', name: 'Фильтр масляный', article: 'F-1', quantity: '2', plate: 'А001АА77' },
      { clientNumber: 'PWA-импорт', name: 'Свеча', article: 'S-2', quantity: '4' }] } });
    try {
      const full = (await admin.list('Document_ЗаказПокупателя', { $filter: `Ref_Key eq ${guid(doc.id)}` }))[0];
      expect(full.Запасы.map(r => r.НоменклатураКлиента)).toEqual(['Фильтр масляный', 'Свеча']);
      const page = await m.call('GET', '/lines', { query: { view: 'sales', customerOrderId: doc.id } });
      expect(page.items.map(l => l.factName).sort(), 'строки АРМ создаёт расширение при записи заказа (не в безопасном режиме)').toEqual(['Свеча', 'Фильтр масляный']);
    } finally {
      await m.call('DELETE', `/sales/customer-orders/${doc.id}`);
    }
  });

  it('команды по заказу: отгрузка (дата и номер), «Подготовлено», проведение — ответ контракта', async ({ skip }) => {
    if (!reachable) skip();
    const m = await session('arm.manager');
    const rec = (await admin.list(ARM, { $filter: `ВидОперации eq 'Продажа' and (СтатусСтроки eq 'Подготовлено' or СтатусСтроки eq 'Собран') and Удаление eq false`, $top: 1 }))[0];
    const order = rec.ДокументЗаказПокупателя_Key;
    const before = await admin.list(ARM, { $filter: `ДокументЗаказПокупателя_Key eq ${guid(order)}` });
    try {
      const r = await m.call('POST', '/sales/shipments', { body: { customerOrderId: order, shipmentDate: '2026-10-13', shipmentNumber: 'ОТГ-PWA' } });
      expect(r.processed).toBeGreaterThan(0);
      expect((await m.call('GET', `/lines/${rec.ИдентификаторЗаписи}`)).shipmentNumber).toBe('ОТГ-PWA');
    } finally { for (const b of before) await restore(b, ['ДатаОтгрузки', 'НомерОтгрузки']); }
    await expect(m.call('POST', '/sales/prepared')).rejects.toMatchObject({ status: 409 });
    // проведение — команда ПровестиЗаказ (АРМ_OData): без отмеченных строк «Подготовлено» — 409 nothing_marked
    await expect(m.call('POST', `/sales/customer-orders/${order}/post`)).rejects.toMatchObject({ status: 409, code: 'nothing_marked' });
  });

  it('команды АРМ_OData: «В работе» без отметок — 409, задание по Ид; «Заказать» — та же команда ВРаботе, отдельной операции нет', async ({ skip }) => {
    if (!reachable) skip();
    const m = await session('arm.manager');
    await expect(m.call('POST', '/sales/jobs', { body: { allowSplit: false } })).rejects.toMatchObject({ status: 409, code: 'nothing_marked' });
    await expect(m.call('GET', '/jobs/cmd-00000000000000000000000000000000')).rejects.toMatchObject({ status: 404 });
    await expect(m.call('POST', '/sales/supplier-orders', { body: {} })).rejects.toMatchObject({ status: 404 });
  });
});
