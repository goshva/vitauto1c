// Работоспособность PWA на копии рабочей базы (дамп autoservice_main, PostgreSQL 18, публикация /odata-main):
// тот же бэкенд, что в браузере (src/odata/backend.js). Пишет только в копию; созданный заказ удаляется.
//   ODATA_URL=http://127.0.0.1:8090/odata-main/odata/standard.odata MAIN_USER=Автосервис npx vitest run -c vitest.e2e.config.js e2e/main-smoke.e2e.js
//   рабочая база, только чтение: ODATA_URL=…/odata-prod/odata/standard.odata MAIN_USER=Администратор MAIN_READONLY=1 …
import { describe, it, expect, beforeAll } from 'vitest';
import { createBackend } from '../src/odata/backend';
import { basicToken } from '../src/odata/client';

const BASE = process.env.ODATA_URL || 'http://127.0.0.1:8090/odata-main/odata/standard.odata';
const LOGIN = process.env.MAIN_USER || 'Автосервис';
const PASSWORD = process.env.MAIN_PASSWORD || '';
const NOM = process.env.MAIN_NOM || 'Громкоговоритель';
// MAIN_READONLY=1 — только чтение (рабочая база): тесты, которые пишут, пропускаются
const READONLY = !!process.env.MAIN_READONLY;
const write = READONLY ? it.skip : it;
let call, user;

beforeAll(async () => {
  const token = basicToken(LOGIN, PASSWORD);
  user = (await createBackend({ baseUrl: BASE, session: { token, user: null } })('POST', '/session', { body: { login: LOGIN, password: PASSWORD } })).data;
  const b = createBackend({ baseUrl: BASE, session: { token, user } });
  call = (m, p, o) => b(m, p, o).then(r => r.data);
}, 600000);

describe(`PWA на копии рабочей базы (${BASE})`, () => {
  it('вход: роль АРМ и элемент «Пользователи»', () => {
    expect(user.role).toBeTruthy();
    expect(user.userRef).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('матрица роли, строки продаж и закупок, итоги отметок', async () => {
    const m = await call('GET', '/matrix');
    expect(m.columns.length).toBe(57);
    for (const view of ['sales', 'purchases']) {
      const page = await call('GET', '/lines', { query: { view, limit: 50 } });
      expect(Array.isArray(page.items)).toBe(true);
      expect(await call('GET', '/selection', { query: { view } })).toHaveProperty('count');
    }
  });

  it(`справочники: номенклатура «${NOM}», контрагенты, договоры, виды услуг, формы оплаты`, async () => {
    const nom = await call('GET', '/directories/nomenclature', { query: { q: NOM } });
    expect(nom.length, `номенклатура «${NOM}»`).toBeGreaterThan(0);
    const cps = await call('GET', '/directories/counterparties');
    expect(cps.length).toBeGreaterThan(0);
    expect(Array.isArray(await call('GET', '/directories/contracts', { query: { ownerId: cps[0].id } }))).toBe(true);
    expect(Array.isArray(await call('GET', '/directories/service-types'))).toBe(true);
    expect(Array.isArray(await call('GET', '/directories/payment-forms'))).toBe(true);
  });

  it('разделы: загруженные товары, услуги и машины (с ценой и госномером)', async () => {
    const goods = await call('GET', '/catalog/goods', { query: { q: 'A0182501901' } });
    expect(goods.items[0]).toMatchObject({ article: '78', price: 625801.51 });
    expect(goods.items[0].unit.name).toBe('шт');
    // услуги — как «ТО» в базе: одна позиция на вид работ, цена по шасси — цены авторабот по моделям
    const services = await call('GET', '/catalog/services');
    const names = services.items.map(s => s.name);
    for (const n of ['ТО', 'Замена маховика', 'Замена сцепления', 'Ремонт КПП', 'С/у Кпп', 'Ремонт правой шахты', 'С/у правой шахты']) expect(names).toContain(n);
    expect(names.some(n => n.includes(' — '))).toBe(false);
    const to = await call('GET', `/catalog/services/${services.items.find(s => s.name === 'ТО').id}`);
    expect(to.price).toBe(432.42);   // базовая — минимальная из цен по шасси
    const byModel = Object.fromEntries(to.modelPrices.map(p => [p.model.name, p.price]));
    expect(byModel['БЕЛАРУС 82.1']).toBe(432.42);
    expect(byModel['КАМАЗ 65115']).toBe(554.15);
    expect(byModel['MERCEDES-BENZ UNIMOG U423 Т']).toBe(1387.16);
    expect(byModel['ЭД244КМ КАМАЗ 53605-L4 (ВПУ-лето)']).toBe(1509.62);
    const cars = await call('GET', '/catalog/cars', { query: { q: 'X89787540F0ET2115' } });
    expect(cars.items[0]).toMatchObject({ plate: 'К255ХО799', year: 2015 });
    expect(cars.items[0].group.name).toBe('Вакуумные подметательно-уборочные машины (ПУ)');
    const groups = await call('GET', '/directories/car-groups');
    const all = await call('GET', '/catalog/cars', { query: { groupId: groups.find(g => g.name === 'Самосвал').id, limit: 200 } });
    expect(all.items).toHaveLength(28);
  });

  write('разделы: создать, изменить (цена, госномер), пометить на удаление и восстановить', async () => {
    const units = await call('GET', '/directories/units');
    const stamp = Date.now();
    for (const kind of ['goods', 'services']) {
      const it = await call('POST', `/catalog/${kind}`, { body: { name: `PWA-проверка ${kind} ${stamp}`, article: `T-${stamp}`, unitId: units[0].id, price: 100.5 } });
      expect(it).toMatchObject({ price: 100.5, type: kind === 'goods' ? 'Запас' : 'Услуга' });
      const upd = (await call('PATCH', `/catalog/${kind}/${it.id}`, { body: { comment: 'проверка', price: 200 } }));
      expect(upd).toMatchObject({ comment: 'проверка', price: 200 });
      expect((await call('DELETE', `/catalog/${kind}/${it.id}`)).deleted).toBe(true);
      expect((await call('POST', `/catalog/${kind}/${it.id}/restore`)).deleted).toBe(false);
      await call('DELETE', `/catalog/${kind}/${it.id}`);
    }
    const [model] = await call('GET', '/directories/car-models', { query: { q: 'БЕЛАРУС' } });
    const vin = `PWATEST${stamp}`.slice(0, 17);
    const car = await call('POST', '/catalog/cars', { body: { vin, plate: 'Т001ТТ77', modelId: model.id, year: 2020 } });
    expect(car).toMatchObject({ vin, plate: 'Т001ТТ77', year: 2020 });
    expect(car.model.id).toBe(model.id);
    await expect(call('POST', '/catalog/cars', { body: { vin } })).rejects.toMatchObject({ status: 409 });
    expect((await call('PATCH', `/catalog/cars/${car.id}`, { body: { plate: 'Т002ТТ77' } })).plate).toBe('Т002ТТ77');
    expect((await call('DELETE', `/catalog/cars/${car.id}`)).deleted).toBe(true);
  });

  write(`новый заказ (команда СоздатьЗаказ) → «Строки в заказ» «${NOM}» → правка, отметка → удаление`, async () => {
    const [cust] = await call('GET', '/directories/counterparties');
    const [nom] = await call('GET', '/directories/nomenclature', { query: { q: NOM } });
    const doc = await call('POST', '/sales/customer-orders', { body: { customerId: cust.id, clientOrderNumber: 'PWA-проверка' } });
    expect(doc.number).toBeTruthy();
    try {
      const card = await call('GET', `/documents/customer_order/${doc.id}`);
      expect(card.counterparty.name).toBe(cust.name);
      const added = await call('POST', '/lines', { body: { view: 'sales', customerOrderId: doc.id, nomenclatureIds: [nom.id] } });
      expect(added[0].nomenclature.name).toBe(nom.name);
      const id = added[0].id;
      const stamp = 'PWA ' + Date.now();
      expect((await call('PATCH', `/lines/${id}`, { body: { field: 'КомментарийКСтроке', value: stamp } })).comment).toBe(stamp);
      expect((await call('PATCH', `/lines/${id}`, { body: { field: 'Количество', value: 2 } })).quantity).toBe(2);
      expect((await call('POST', `/lines/${id}/mark`)).marked).toBe(true);
      expect((await call('GET', '/selection', { query: { view: 'sales' } })).count).toBeGreaterThan(0);
      expect((await call('POST', `/lines/${id}/mark`)).marked).toBe(false);
      const page = await call('GET', '/lines', { query: { view: 'sales', customerOrderId: doc.id } });
      expect(page.items.map(l => l.id)).toContain(id);
    } finally {
      await call('DELETE', `/sales/customer-orders/${doc.id}`);
    }
  });
});
