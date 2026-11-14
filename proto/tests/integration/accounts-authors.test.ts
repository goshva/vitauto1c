import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { decodeSession, encodeSession } from '../../src/session.ts';

// Учётные записи, автор резерва (ФТ v2 п. 10) и автор документа (п. 20).
//
// Учётные записи заказчик задал сам: admin/admin123, manager/manager123,
// store/store123, mechanic/mechanic123.

const USERS: Record<string, { login: string; password: string; role: string }> = {
  admin: { login: 'admin', password: 'admin123', role: 'admin' },
  manager: { login: 'manager', password: 'manager123', role: 'manager' },
  store: { login: 'store', password: 'store123', role: 'storekeeper' },
  mechanic: { login: 'mechanic', password: 'mechanic123', role: 'mechanic' },
};

const NOM = '77777777-7777-7777-7777-777777777701';
const WH = '44444444-4444-4444-4444-444444444401';
const CUSTOMER = '66666666-6666-6666-6666-666666666601';

/** Войти и получить куку сессии. */
async function login(login: string, password: string): Promise<{ status: number; cookie: string }> {
  const r = await app.request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ login, password }).toString(),
  });
  const raw = r.headers.get('set-cookie') ?? '';
  const m = /arm_session=([^;]+)/.exec(raw);
  return { status: r.status, cookie: m ? `arm_session=${m[1]}` : '' };
}

const userId = async (login: string): Promise<string> =>
  String((await pool.query<{ id: string }>(
    `select id from app_user where login = $1`, [login])).rows[0]!.id);

const json = async (url: string, init: RequestInit = {}, cookie = '') => {
  const r = await app.request(url, {
    ...init,
    headers: { accept: 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

const post = (url: string, body: unknown, cookie = '') =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, cookie);

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('учётные записи', () => {
  test('четыре учётки заведены с теми логинами и ролями', async () => {
    const r = await pool.query<{ login: string; role: string }>(
      `select login, role from app_user where active and deleted_at is null order by login`);
    expect(r.rows.map((x) => `${x.login}:${x.role}`).sort()).toEqual([
      'admin:admin', 'manager:manager', 'mechanic:mechanic', 'store:storekeeper',
    ]);
  });

  test('пароли ХЕШИРОВАНЫ, а не лежат как есть', async () => {
    const r = await pool.query<{ password_hash: string }>(`select password_hash from app_user`);
    for (const row of r.rows) {
      expect(row.password_hash, 'пароль хранится открытым текстом').not.toContain('123');
      expect(row.password_hash.startsWith('$2'), 'хеш не bcrypt').toBe(true);
    }
  });

  test('каждый входит со своим паролем и получает СВОЮ роль', async () => {
    for (const u of Object.values(USERS)) {
      const { status, cookie } = await login(u.login, u.password);
      expect(status, `${u.login}: вход не прошёл`).toBe(302);
      expect(cookie, `${u.login}: сессия не поставлена`).toBeTruthy();

      const session = decodeSession(cookie.replace('arm_session=', ''));
      expect(session!.role, `${u.login}: роль не совпала`).toBe(u.role);
      expect(session!.userId).toBe(await userId(u.login));
    }
  });

  test('неверный пароль не пускает', async () => {
    const { status, cookie } = await login('admin', 'неверный');
    expect(status).toBe(401);
    expect(cookie, 'сессия поставлена без верного пароля').toBe('');
  });

  test('неизвестный логин не пускает — и причина та же, что при неверном пароле', async () => {
    const r = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ login: 'нетакого', password: 'x' }).toString(),
    });
    const body = await r.text();
    expect(r.status).toBe(401);
    // Разные сообщения подсказали бы, какие логины существуют.
    expect(body).toContain('Неверный логин или пароль');
  });

  test('кука ПОДПИСАНА: подделка не проходит', async () => {
    const { cookie } = await login('store', 'store123');
    const value = cookie.replace('arm_session=', '');

    // Меняем роль в полезной нагрузке, подпись оставляем прежней.
    const [body, mac] = value.split('.') as [string, string];
    const payload = Buffer.from(body, 'base64url').toString('utf8');
    const forged = Buffer.from(payload.replace('storekeeper', 'admin'), 'utf8')
      .toString('base64url');

    expect(decodeSession(`${forged}.${mac}`), 'подделанная кука принята').toBe(null);
  });

  test('вошедший НЕ подменяет роль заголовком', async () => {
    const { cookie } = await login('store', 'store123');

    // Кладовщик просит себе права администратора заголовком — не должен получить.
    const r = await json('/lines?limit=1', { headers: { 'x-role': 'admin' } }, cookie);
    expect(r.status).toBe(200);
    // Себестоимость ему закрыта (ФТ v2 п. 5) — значит, роль взята из СЕССИИ.
    const item = (r.body.items as Record<string, unknown>[])[0]!;
    expect(item, 'заголовок X-Role подменил роль вошедшего').not.toHaveProperty('costPrice');
  });

  test('выход снимает сессию', async () => {
    const { cookie } = await login('manager', 'manager123');
    const out = await app.request('/logout', { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(302);
    expect(out.headers.get('set-cookie') ?? '', 'кука не снята').toContain('arm_session=;');
  });

  test('страница входа отдаётся и перечисляет демо-учётки', async () => {
    const r = await app.request('/login', { headers: { accept: 'text/html' } });
    const body = await r.text();
    expect(r.status).toBe(200);
    expect(body).toContain('data-testid="login-form"');
    expect(body).toContain('admin123');
  });
});

describe('ФТ п. 10 · снять резерв может только автор', () => {
  /** Зарезервировать от имени вошедшего. */
  async function reserve(cookie: string): Promise<void> {
    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, kind: 'reserve', quantity: '2',
    }, cookie);
  }

  test('резерв записывает АВТОРА', async () => {
    const { cookie } = await login('store', 'store123');
    await reserve(cookie);

    const r = await pool.query<{ author_id: string | null }>(
      `select author_id from stock_move where kind = 'reserve' order by created_at desc limit 1`);
    expect(r.rows[0]!.author_id, 'автор резерва не записан').toBe(await userId('store'));
  });

  test('другой кладовщик резерв снять НЕ может', async () => {
    const store = await login('store', 'store123');
    await reserve(store.cookie);

    // Второй пользователь с ТОЙ ЖЕ ролью — «система сверяет автора», а не роль.
    const other = encodeSession({ userId: await userId('manager'), role: 'storekeeper' });
    const r = await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, kind: 'unreserve', quantity: '1',
    }, `arm_session=${other}`);

    expect(r.status, 'чужой резерв снят').toBe(403);
    expect(r.body.code).toBe('not_author');
  });

  test('автор снимает свой резерв', async () => {
    const store = await login('store', 'store123');
    await reserve(store.cookie);

    const r = await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, kind: 'unreserve', quantity: '1',
    }, store.cookie);
    expect(r.status, 'автор не смог снять свой резерв').toBe(201);
  });

  test('администратор снимает любой резерв — у него полный доступ', async () => {
    const store = await login('store', 'store123');
    await reserve(store.cookie);

    const admin = await login('admin', 'admin123');
    const r = await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, kind: 'unreserve', quantity: '1',
    }, admin.cookie);
    expect(r.status).toBe(201);
  });

  test('отказ не оставляет следа в движениях', async () => {
    const store = await login('store', 'store123');
    await reserve(store.cookie);
    const before = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from stock_move`)).rows[0]!.n);

    const other = encodeSession({ userId: await userId('manager'), role: 'storekeeper' });
    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, kind: 'unreserve', quantity: '1',
    }, `arm_session=${other}`);

    const after = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from stock_move`)).rows[0]!.n);
    expect(after, 'отказ оставил движение в журнале').toBe(before);
  });
});

describe('ФТ п. 20 · изменять документ может только автор', () => {
  /** Заказ, заведённый от имени вошедшего. */
  async function order(cookie: string): Promise<string> {
    const r = await post('/imports', {
      customerId: CUSTOMER, clientOrderNumber: 'З-9901',
      rows: [{ name: 'Фильтр масляный', article: 'FLT-OIL-001', quantity: '1' }],
    }, cookie);
    return String(r.body.orderId);
  }

  test('заказ записывает АВТОРА', async () => {
    const manager = await login('manager', 'manager123');
    const id = await order(manager.cookie);

    const r = await pool.query<{ author_id: string | null }>(
      `select author_id from customer_order where id = $1`, [id]);
    expect(r.rows[0]!.author_id, 'автор заказа не записан').toBe(await userId('manager'));
  });

  test('чужой документ не изменить', async () => {
    const manager = await login('manager', 'manager123');
    const id = await order(manager.cookie);

    // Другой пользователь с ТОЙ ЖЕ ролью: менеджер менеджеру не указ.
    const other = encodeSession({ userId: await userId('store'), role: 'manager' });
    const r = await json(`/orders/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'client_order_number', value: 'З-ЧУЖОЙ' }),
    }, `arm_session=${other}`);

    expect(r.status).toBe(403);
    expect(r.body.code).toBe('not_author');
  });

  test('автор правит свой документ', async () => {
    const manager = await login('manager', 'manager123');
    const id = await order(manager.cookie);

    const r = await json(`/orders/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'client_order_number', value: 'З-АВТОР' }),
    }, manager.cookie);
    expect(r.status, 'автор не смог изменить свой заказ').toBe(200);
  });

  test('администратор правит чужой документ — у него полный доступ', async () => {
    const manager = await login('manager', 'manager123');
    const id = await order(manager.cookie);

    const admin = await login('admin', 'admin123');
    const r = await json(`/orders/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'client_order_number', value: 'З-АДМИН' }),
    }, admin.cookie);
    expect(r.status).toBe(200);
  });

  test('ПРОСМОТР чужого документа не закрыт — закрыто только изменение', async () => {
    const manager = await login('manager', 'manager123');
    const id = await order(manager.cookie);

    const admin = await login('admin', 'admin123');
    const r = await json(`/orders/${id}`, {}, admin.cookie);
    expect(r.status, 'просмотр закрыли вместе с изменением').toBe(200);

    const store = await login('store', 'store123');
    const view = await json(`/orders/${id}`, {}, store.cookie);
    expect(view.status).toBe(200);
  });

  test('документ БЕЗ автора правит любой с правом — он его заполняет', async () => {
    const manager = await login('manager', 'manager123');
    const id = await order(manager.cookie);
    await pool.query(`update customer_order set author_id = null where id = $1`, [id]);

    const store = encodeSession({ userId: await userId('store'), role: 'manager' });
    const r = await json(`/orders/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'client_order_number', value: 'З-НИЧЕЙ' }),
    }, `arm_session=${store}`);
    expect(r.status, 'ничей документ оказался недоступен навсегда').toBe(200);
  });
});
