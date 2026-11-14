import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { checkAccess } from '../../src/domain/access.ts';

// ФТ v2 п. 16: «Закупка из рабочего места. Форма выбора поставщика — справочник
// „Контрагенты“ по алфавиту. Если позиция уже покупалась — подсказка „у кого и по
// какой цене“ по истории закупок и остаткам, плюс блок „Аналоги“».
//
// Решение заказчика (14.11.2026): кнопка в рабочем месте снабжения И у
// администратора; право вшито в роль менеджера и администратора.

type Role = 'admin' | 'manager' | 'storekeeper' | 'mechanic';
const as = (role: Role) => ({
  accept: 'text/html', 'x-role': role,
});

const NOM = '77777777-7777-7777-7777-777777777702';
const NOM_ANALOG = '77777777-7777-7777-7777-777777777709';

const json = async (url: string, role: Role = 'admin') => {
  const r = await app.request(url, { headers: { accept: 'application/json', 'x-role': role } });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const html = async (url: string, role: Role = 'admin') => {
  const r = await app.request(url, { headers: as(role) });
  return { status: r.status, body: await r.text() };
};
const uiPost = (url: string, body: Record<string, string>, role: Role = 'admin') =>
  app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-role': role },
    body: new URLSearchParams(body).toString(),
  });

/** Строка снабжения с номенклатурой, отмеченная для закупки. */
async function markedSupplyLine(): Promise<string> {
  const id = String((await pool.query<{ id: string }>(
    `select id from line where not deleted limit 1`)).rows[0]!.id);
  await pool.query(
    `update line set nomenclature_id = $2, status = 'ordered' where id = $1`, [id, NOM]);
  await app.request(`/lines/${id}/mark`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ marked: true }),
  });
  return id;
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('№16 · кнопка «Новая закупка»', () => {
  test('есть в рабочем месте снабжения', async () => {
    const { body } = await html('/supply');
    expect(body, 'кнопки закупки нет в снабжении').toContain('data-testid="chain-purchase"');
    expect(body, 'кнопка не открывает форму').toContain('/ui/supply/new-purchase');
  });

  test('есть и в списке строк — тот же обработчик', async () => {
    const { body } = await html('/lines');
    expect(body).toContain('data-testid="chain-purchase"');
  });

  test('право вшито в роль: менеджер и администратор', () => {
    expect(checkAccess('manager', 'purchase.create')).toBeNull();
    expect(checkAccess('admin', 'purchase.create')).toBeNull();
  });

  test('кладовщику закупка закрыта — он принимает, а не покупает', () => {
    expect(checkAccess('storekeeper', 'purchase.create')).toBeTruthy();
    expect(checkAccess('mechanic', 'purchase.create')).toBeTruthy();
  });

  test('кладовщику форма не открывается, и причина названа', async () => {
    const id = await markedSupplyLine();
    expect(id).toBeTruthy();

    const r = await html('/ui/supply/new-purchase', 'storekeeper');
    expect(r.status).toBe(403);
    expect(r.body, 'отказ без причины').toContain('purchase.create');
  });

  test('закупку нельзя создать кладовщику — сервер, а не только кнопка', async () => {
    await markedSupplyLine();
    const r = await uiPost('/ui/supply/purchase', { supplierId: '' }, 'storekeeper');
    expect(r.status).toBe(403);
  });
});

describe('№16 · форма выбора поставщика', () => {
  test('поставщики идут ПО АЛФАВИТУ', async () => {
    const { status, body } = await json('/suppliers');
    expect(status).toBe(200);

    const names = (body.items as { name: string }[]).map((s) => s.name);
    expect(names.length, 'поставщиков нет').toBeGreaterThan(1);
    expect(names, 'порядок не алфавитный').toEqual([...names].sort());
  });

  test('в списке только ПОСТАВЩИКИ — заказчиков там быть не должно', async () => {
    const { body } = await json('/suppliers');
    const ids = (body.items as { id: string }[]).map((s) => s.id);

    const notSuppliers = await pool.query<{ n: string }>(
      `select count(*)::text n from counterparty
        where id = any($1::uuid[]) and not is_supplier`, [ids]);
    expect(Number(notSuppliers.rows[0]!.n), 'в выборе поставщика оказался заказчик').toBe(0);
  });

  test('форма открывается и показывает выбор поставщика', async () => {
    await markedSupplyLine();
    const { status, body } = await html('/ui/supply/new-purchase');

    expect(status).toBe(200);
    expect(body).toContain('data-testid="purchase-form"');
    expect(body).toContain('data-testid="purchase-supplier"');
    expect(body).toContain('Создать закупку');
  });

  test('без отмеченной строки форма объясняет, что делать', async () => {
    const { body } = await html('/ui/supply/new-purchase');
    expect(body, 'пустая форма без объяснения').toContain('data-testid="purchase-note"');
  });
});

describe('№16 · «у кого и по какой цене»', () => {
  test('история закупок показывает поставщика и цену', async () => {
    // Заводим факт покупки: строка с поставщиком и ценой.
    const id = await markedSupplyLine();
    const supplier = String((await pool.query<{ id: string }>(
      `select id from counterparty where is_supplier and deleted_at is null limit 1`)).rows[0]!.id);
    await pool.query(
      `update line set supplier_id = $2, cost_price = 1234.50, order_date = current_date
        where id = $1`, [id, supplier]);

    const { status, body } = await json(`/nomenclature/${NOM}/purchase-history`);
    expect(status).toBe(200);

    const history = body.history as { supplier: string; price: string }[];
    expect(history.length, 'история закупок пуста').toBeGreaterThan(0);
    expect(history[0]!.price, 'цена не попала в историю').toBe('1234.50');
    expect(history[0]!.supplier, 'поставщик не назван').toBeTruthy();
  });

  test('история показывает и остаток, и то, что уже заказано', async () => {
    await markedSupplyLine();
    const { body } = await json(`/nomenclature/${NOM}/purchase-history`);

    expect(body, 'нет остатка').toHaveProperty('onHand');
    expect(body, 'нет «уже заказано» — снабженец купит лишнее').toHaveProperty('onOrder');
  });

  test('без истории форма прямо об этом говорит', async () => {
    await markedSupplyLine();
    const { body } = await html('/ui/supply/new-purchase');
    expect(body, 'нет объяснения при пустой истории').toContain('data-testid="purchase-no-history"');
  });

  test('неизвестная номенклатура → 404, а не пустой ответ', async () => {
    const { status } = await json('/nomenclature/00000000-0000-0000-0000-0000000000ff/purchase-history');
    expect(status).toBe(404);
  });
});

describe('№16 · блок «Аналоги»', () => {
  test('аналог показывается с остатком', async () => {
    const { body } = await json(`/nomenclature/${NOM}/purchase-history`);
    const analogs = body.analogs as { id: string; name: string; onHand: string }[];

    expect(analogs.length, 'аналогов нет').toBeGreaterThan(0);
    expect(analogs[0]!.id).toBe(NOM_ANALOG);
    expect(analogs[0], 'нет остатка аналога — непонятно, есть ли замена').toHaveProperty('onHand');
  });

  test('связь ищется в ОБЕ стороны', async () => {
    // Связь заведена от A-002 к A-002B. Со стороны A-002B она должна находиться тоже:
    // иначе половина аналогов терялась бы в зависимости от карточки.
    const { body } = await json(`/nomenclature/${NOM_ANALOG}/purchase-history`);
    const analogs = body.analogs as { id: string }[];
    expect(analogs.map((a) => a.id), 'обратная связь не найдена').toContain(NOM);
  });

  test('позиция не может быть аналогом сама себе — это держит база', async () => {
    let denied = false;
    try {
      await pool.query(`update nomenclature set analog_id = id where id = $1`, [NOM]);
    } catch {
      denied = true;
    }
    expect(denied, 'проверка «не сам себе» отсутствует').toBe(true);
  });

  test('аналог ссылается на существующую номенклатуру', async () => {
    let denied = false;
    try {
      await pool.query(`update nomenclature set analog_id = $2 where id = $1`,
        [NOM, '00000000-0000-0000-0000-0000000000ff']);
    } catch {
      denied = true;
    }
    expect(denied, 'внешнего ключа на аналог нет').toBe(true);
  });

  test('без аналогов форма говорит об этом, а не молчит', async () => {
    await pool.query(`update nomenclature set analog_id = null where analog_id is not null`);
    await markedSupplyLine();
    const { body } = await html('/ui/supply/new-purchase');
    expect(body).toContain('data-testid="purchase-no-analogs"');
  });
});

describe('№16 · создание закупки из формы', () => {
  test('закупка создаётся с ВЫБРАННЫМ поставщиком', async () => {
    const id = await markedSupplyLine();
    const supplier = String((await pool.query<{ id: string }>(
      `select id from counterparty where is_supplier and deleted_at is null
        order by name limit 1`)).rows[0]!.id);

    const r = await uiPost('/ui/supply/purchase', { lineId: id, supplierId: supplier });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('data-testid="purchase-done"');

    const so = await pool.query<{ counterparty_id: string | null }>(
      `select counterparty_id from supplier_order order by created_at desc limit 1`);
    expect(so.rows[0]!.counterparty_id, 'поставщик не тот, кого выбрали').toBe(supplier);
  });

  test('без выбранного поставщика закупка не создаётся', async () => {
    const id = await markedSupplyLine();
    const before = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from supplier_order`)).rows[0]!.n);

    const r = await uiPost('/ui/supply/purchase', { lineId: id, supplierId: '' });
    expect(r.status).toBe(400);

    const after = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from supplier_order`)).rows[0]!.n);
    expect(after, 'закупка создалась без поставщика').toBe(before);
  });

  test('неопознанную позицию закупать не даёт — сначала опознание', async () => {
    const id = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await pool.query(`update line set nomenclature_id = null, status = 'ordered' where id = $1`, [id]);
    await app.request(`/lines/${id}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: true }),
    });

    const { body } = await html('/ui/supply/new-purchase');
    expect(body, 'неопознанную позицию предлагают закупать').toContain('purchase-need-identify');
    expect(body, 'нет ссылки на экран опознания').toContain('/unidentified');
  });
});
