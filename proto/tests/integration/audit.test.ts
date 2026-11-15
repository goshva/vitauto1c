import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { encodeSession } from '../../src/session.ts';

// Журнал действий: «кто изменил цену» — первый вопрос при разборе претензии.
//
// До журнала ответить было нечем: `updated_at` говорил, что строку трогали, но не
// говорил ни КТО, ни что было до этого. `author_id` отвечал только за создание.
//
// Проверяем не наличие таблицы, а ОТВЕТЫ: по записи журнала должно быть видно, кто,
// что и когда поменял — и запись должна читаться даже после переименования учётной
// записи.

const manager = '11111111-aaaa-1111-1111-111111111102';
const store = '11111111-aaaa-1111-1111-111111111103';
const mechanic = '11111111-aaaa-1111-1111-111111111104';

const asManager = `arm_session=${encodeSession({ userId: manager, role: 'manager' })}`;
const asStore = `arm_session=${encodeSession({ userId: store, role: 'storekeeper' })}`;
const asMechanic = `arm_session=${encodeSession({ userId: mechanic, role: 'mechanic' })}`;

const json = async (url: string, init: RequestInit = {}, cookie = '') => {
  const r = await app.request(url, {
    ...init,
    headers: { accept: 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const patch = (id: string, field: string, value: string, cookie = '') =>
  json(`/lines/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ field, value }),
  }, cookie);
const post = (url: string, body: unknown, cookie = '') =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, cookie);
const html = async (url: string, cookie = '') => {
  const r = await app.request(url, { headers: { accept: 'text/html', cookie } });
  return { status: r.status, body: await r.text() };
};

/** Строка с себестоимостью — чтобы коэффициент было к чему применять. */
async function pricedLine(): Promise<string> {
  const id = String((await pool.query<{ id: string }>(
    `select id from line where not deleted limit 1`)).rows[0]!.id);
  await pool.query(
    `update line set cost_price = 1000, sale_price = 1500, coefficient = null,
            status = 'new', nomenclature_id = '77777777-7777-7777-7777-777777777702'
      where id = $1`, [id]);
  await pool.query(`delete from audit_log`);
  return id;
}

const logOf = async (id: string) =>
  (await pool.query<{
    action: string; field: string | null; old_value: string | null;
    new_value: string | null; login: string | null; role: string | null;
    user_id: string | null; comment: string | null;
  }>(`select action, field, old_value, new_value, login, role, user_id, comment
        from audit_log where entity = 'line' and entity_id = $1
       order by at desc, id desc`, [id])).rows;

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
  await pool.query(`delete from audit_log`);
});

describe('аудит · КТО ИЗМЕНИЛ ЦЕНУ', () => {
  test('правка цены записывает автора, «было» и «стало»', async () => {
    const id = await pricedLine();

    const r = await patch(id, 'sale_price', '1800', asManager);
    expect(r.status).toBe(200);

    const rows = await logOf(id);
    const price = rows.find((x) => x.field === 'sale_price');
    expect(price, 'правка цены не записана').toBeTruthy();
    expect(price!.login, 'не записано, КТО изменил цену').toBe('manager');
    expect(price!.user_id).toBe(manager);
    expect(price!.old_value, 'не записано «было»').toBe('1500.00');
    expect(price!.new_value, 'не записано «стало»').toBe('1800');
  });

  test('коэффициент двигает цену — и это видно в записи', async () => {
    const id = await pricedLine();

    // Цена = себестоимость × множитель: 1000 × 2 = 2000.
    await patch(id, 'coefficient', '2', asManager);

    const rows = await logOf(id);
    const coef = rows.find((x) => x.field === 'coefficient');
    expect(coef, 'правка коэффициента не записана').toBeTruthy();
    expect(coef!.old_value).toBe(null);
    expect(coef!.new_value).toBe('2');

    // Главное: при разборе важно понять, что цена поехала РАСЧЁТОМ, а не вручную.
    const details = (await pool.query<{ details: Record<string, unknown> }>(
      `select details from audit_log where field = 'coefficient'`)).rows[0]!.details;
    expect(String(details.salePriceAfter), 'не сохранена цена после расчёта').toContain('2000');
  });

  test('ручной ввод цены объясняет, что коэффициент сброшен', async () => {
    const id = await pricedLine();
    await patch(id, 'sale_price', '1900', asManager);

    const rows = await logOf(id);
    const price = rows.find((x) => x.field === 'sale_price');
    expect(price!.comment, 'не сказано, почему коэффициент пропал').toContain('расчёт');
  });

  test('несколько правок — вся цепочка, от свежих к старым', async () => {
    const id = await pricedLine();
    await patch(id, 'sale_price', '1600', asManager);
    await patch(id, 'sale_price', '1700', asManager);
    await patch(id, 'sale_price', '1750', asManager);

    const rows = (await logOf(id)).filter((x) => x.field === 'sale_price');
    expect(rows.length, 'цепочка правок неполна').toBe(3);
    // Порядок: первая запись — последняя правка. При разборе нужен последний, кто
    // тронул, а не первый.
    expect(rows[0]!.new_value).toBe('1750');
    expect(rows[2]!.new_value).toBe('1600');
  });

  test('РАЗНЫЕ ЛЮДИ — в записях оба', async () => {
    const id = await pricedLine();
    await patch(id, 'sale_price', '1600', asManager);
    // Поступление правит кладовщик — но себестоимость ему закрыта (ФТ v2 п. 5),
    // поэтому меняем поле, которое ему доступно.
    await patch(id, 'comment', 'поставка задержана', asStore);

    // Логин учётной записи — `store`; `storekeeper` — это роль, и она в журнале
    // лежит отдельным полем. Разделение намеренное: логин говорит «кто», роль —
    // «с какими правам��».
    const rows = await logOf(id);
    expect(rows.map((x) => x.login), 'в журнале не оба сотрудника')
      .toEqual(expect.arrayContaining(['manager', 'store']));
    expect(rows.find((x) => x.login === 'store')!.role).toBe('storekeeper');
  });
});

describe('аудит · что ещё записывается', () => {
  test('смена состояния — отдельным видом действия', async () => {
    const id = await pricedLine();
    await post(`/lines/${id}/mark`, { marked: true }, asManager);
    // Из «Новый» переход только в «Зарезервировать» — так устроена таблица
    // переходов: `from: ['new', 'in_work']`.
    const moved = await post('/lines/transition', { to: 'reserve' }, asManager);
    expect(moved.status, 'переход не состоялся').toBe(200);

    const rows = await logOf(id);
    const tr = rows.find((x) => x.action === 'transition');
    expect(tr, 'смена состояния не записана').toBeTruthy();
    expect(tr!.field).toBe('status');
    expect(tr!.old_value).toBe('new');
    expect(tr!.new_value).toBe('reserve');
    expect(tr!.login).toBe('manager');
  });

  test('отказ перехода НЕ записывается — журнал говорит о случившемся', async () => {
    const id = await pricedLine();
    await post(`/lines/${id}/mark`, { marked: true }, asManager);
    // Из «Новый» в «Отгружен» нельзя.
    // Отказ перехода отдаёт 409, когда не перешла НИ ОДНА строка: молчаливый
    // «успех» скрывал бы, что ничего не произошло.
    const denied = await post('/lines/transition', { to: 'shipped' }, asManager);
    expect(denied.status).toBe(409);

    const transitions = (await logOf(id)).filter((x) => x.action === 'transition');
    expect(transitions.length, 'записан переход, которого ��е было').toBe(0);
  });

  test('создание и удаление документа', async () => {
    const id = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await pool.query(
      `update line set status = 'in_transit', cell_id = '88888888-8888-8888-8888-888888888802',
              warehouse_id = '44444444-4444-4444-4444-444444444401' where id = $1`, [id]);
    await post(`/lines/${id}/mark`, { marked: true }, asManager);

    const created = await post('/receipts', {}, asManager);
    const receiptId = String(created.body.id);

    const afterCreate = (await pool.query<{ action: string }>(
      `select action from audit_log where entity = 'receipt' and entity_id = $1`,
      [receiptId])).rows.map((x) => x.action);
    expect(afterCreate, 'создание приёмки не записано').toContain('create');

    await json(`/receipts/${receiptId}`, { method: 'DELETE' }, asManager);
    const afterDelete = (await pool.query<{ action: string }>(
      `select action from audit_log where entity = 'receipt' and entity_id = $1`,
      [receiptId])).rows.map((x) => x.action);
    expect(afterDelete, 'удаление приёмки не записано').toContain('delete');
  });
});

describe('аудит · запись переживает переименование', () => {
  test('логин сохранён в записи, а не берётся ссылкой', async () => {
    const id = await pricedLine();
    await patch(id, 'sale_price', '1800', asManager);

    // Учётную запись переименовали. Журнал обязан остаться читаемым: иначе через
    // месяц в записи будет пустой идентификатор и разбор прекратится.
    await pool.query(`update app_user set login = 'manager2' where id = $1`, [manager]);

    try {
      const rows = await logOf(id);
      expect(rows[0]!.login, 'запись потеряла автора после переименования').toBe('manager');
    } finally {
      await pool.query(`update app_user set login = 'manager' where id = $1`, [manager]);
    }
  });

  test('удаление учётной записи не обнуляет автора', async () => {
    const id = await pricedLine();
    await patch(id, 'sale_price', '1800', asManager);

    await pool.query(`update app_user set deleted_at = now() where id = $1`, [manager]);
    try {
      const rows = await logOf(id);
      expect(rows[0]!.login, 'автор исчез вместе с учётной записью').toBe('manager');
    } finally {
      await pool.query(`update app_user set deleted_at = null where id = $1`, [manager]);
    }
  });
});

describe('аудит · чтение закрыто по праву', () => {
  test('история строки: администратору и менеджеру — нет', async () => {
    const id = await pricedLine();
    await patch(id, 'sale_price', '1800', asManager);

    const denied = await json(`/lines/${id}/history`, {}, asManager);
    expect(denied.status, 'менеджер прочитал журнал с себестоимостью').toBe(403);

    const admin = await json(`/lines/${id}/history`, { headers: { 'x-role': 'admin' } });
    expect(admin.status).toBe(200);
    expect((admin.body.items as unknown[]).length).toBeGreaterThan(0);
  });

  test('механику журнал закрыт — там себестоимость и история цен', async () => {
    expect((await html('/audit', asMechanic)).status).toBe(403);
    expect((await html('/audit', asStore)).status).toBe(403);
  });

  test('экран журнала открывается администратору и отбирает', async () => {
    const id = await pricedLine();
    await patch(id, 'sale_price', '1800', asManager);

    const r = await html('/audit', 'x-role=admin');
    expect(r.status, 'админ не открыл журнал').toBe(200);
    expect(r.body).toContain('data-testid="audit-table"');
    expect(r.body, 'в журнале нет правки цены').toContain('цена продажи');
  });

  test('панель истории строки — там, где вопрос и задают', async () => {
    const id = await pricedLine();
    await patch(id, 'sale_price', '1800', asManager);

    const r = await html(`/ui/lines/${id}/history`, 'x-role=admin');
    expect(r.status).toBe(200);
    expect(r.body).toContain('data-testid="history-panel"');
    expect(r.body, 'в истории строки нет изменения').toContain('1800');
  });

  test('отбор журнала сужается по полю и по логину', async () => {
    const id = await pricedLine();
    await patch(id, 'sale_price', '1800', asManager);
    await patch(id, 'comment', 'ждём', asManager);

    const r = await app.request('/audit?field=sale_price', {
      headers: { accept: 'application/json', 'x-role': 'admin' },
    });
    const body = (await r.json()) as { items: { field: string }[] };
    expect(body.items.length, 'отбор по полю не сработал').toBe(1);
    expect(body.items[0]!.field).toBe('sale_price');

    const other = await app.request('/audit?field=coefficient', {
      headers: { accept: 'application/json', 'x-role': 'admin' },
    });
    expect(((await other.json()) as { items: unknown[] }).items.length,
      'отбор не сузил выдачу').toBe(0);
  });

  test('пустой журнал объясняется словами, а не пустой таблицей', async () => {
    await pool.query(`delete from audit_log`);
    const r = await html('/audit', 'x-role=admin');
    expect(r.body).toContain('data-testid="audit-empty"');
    // Важно сказать, что журнал не с начала времён: иначе пустота читается как
    // «ничего не меняли».
    expect(r.body).toContain('с момента его включения');
  });
});

describe('аудит · журнал не мешает работе', () => {
  test('сбой записи не отменяет саму правку', async () => {
    const id = await pricedLine();

    // Свидетель ��е должен ронять работу: если запись в журнал не удалась, правка
    // всё равно нужна. Иначе сбой журнала останавливал бы склад.
    const broken = await pool.query(
      `alter table audit_log add constraint audit_probe check (entity <> 'line')`);
    try {
      const r = await patch(id, 'sale_price', '1999', asManager);
      expect(r.status, 'сбой журнала отменил правку').toBe(200);

      const price = await pool.query<{ sale_price: string }>(
        `select sale_price::text from line where id = $1`, [id]);
      expect(price.rows[0]!.sale_price).toContain('1999');
    } finally {
      await pool.query(`alter table audit_log drop constraint audit_probe`);
      void broken;
    }
  });
});
