import { beforeEach, describe, expect, test } from 'bun:test';
import { request } from '../helpers/request.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { encodeSession } from '../../src/session.ts';

// БТ п. 18: «При возврате без документов кладовщик самостоятельно ВИЗУАЛЬНО
// ИДЕНТИФИЦИРУЕТ деталь. Заявку на возврат поставщику может оформить как менеджер,
// так и кладовщик. Возврат от клиента поддерживается типовым документом».
//
// Смысл экрана: клиент принёс деталь без бумаг, и кладовщику НЕЧЕГО отметить в
// обычном списке строк — он не знает, какая из них эта. Он опознаёт её глазами и
// ищет соответствующую ПРОДАННУЮ строку по машине, названию и артикулу.

const store = '11111111-aaaa-1111-1111-111111111103';
const manager = '11111111-aaaa-1111-1111-111111111102';
const mechanic = '11111111-aaaa-1111-1111-111111111104';

const asStore = `arm_session=${encodeSession({ userId: store, role: 'storekeeper' })}`;
const asManager = `arm_session=${encodeSession({ userId: manager, role: 'manager' })}`;
const asMechanic = `arm_session=${encodeSession({ userId: mechanic, role: 'mechanic' })}`;

const NOM = '77777777-7777-7777-7777-777777777702';
/** Машина, к которой привязана отгрузка: по её атрибутам ищет подбор. */
const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';

const html = async (url: string, cookie = '') => {
  const r = await request(url, {
    headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) },
  });
  return { status: r.status, body: await r.text() };
};
const uiPost = (url: string, body: Record<string, string | string[]>, cookie = '') => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (Array.isArray(v)) for (const x of v) params.append(k, x);
    else params.append(k, v);
  }
  return request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: params.toString(),
  });
};

/** Проданная строка: уехала клиенту и ещё не возвращена. */
async function soldLine(opts: { plate?: string; name?: string; status?: string } = {}): Promise<string> {
  const id = String((await pool.query<{ id: string }>(
    `select id from line where not deleted limit 1`)).rows[0]!.id);

  await pool.query(
    `update line set nomenclature_id = $2, status = $3, return_id = null,
            shipment_doc_id = (select id from shipment limit 1)
      where id = $1`,
    [id, NOM, opts.status ?? 'shipped']);

  await pool.query(`update line_fact set fact_name = $2 where id = $1`,
    [id, opts.name ?? 'Фильтр масляный']);

  // ГОС. НОМЕР В ПРЕДСТАВЛЕНИИ БЕРЁТСЯ ИЗ АТРИБУТОВ МАШИНЫ ОТГРУЗКИ, а не из факта
  // заявки: в факте он «как написал клиент», а ищут по карточке машины. Первая
  // версия теста писала номер в факт и ждала, что подбор его увидит, — не увидел.
  //
  // ОБНОВЛЯЕМ существующий атрибут, а не добавляем второй: у машины ровно один
  // государственный номер. Вторая запись того же вида роняет представление —
  // `line_view` берёт значение подзапросом без `limit`, и «более одной строки»
  // превращается в ошибку всего списка.
  //
  // Лишние записи УДАЛЯЕМ: прогон, упавший на середине, оставил бы дубль в базе, и
  // следующий прогон падал бы уже не на своей ошибке — ровно это и случилось.
  await pool.query(
    `delete from car_attribute where car_id = $1 and attr_kind = 'plate'
      and id not in (select id from car_attribute
                      where car_id = $1 and attr_kind = 'plate' order by id limit 1)`,
    [CAR]);
  await pool.query(
    `update car_attribute set value_value = $2
      where car_id = $1 and attr_kind = 'plate'`,
    [CAR, opts.plate ?? 'А123ВС77']);

  // Отгрузка с этой машиной: через неё строке доступны атрибуты авто, и по ним
  // работает поиск. Оттуда же берётся дата отгрузки — у строки своей нет.
  await pool.query(
    `insert into shipment (id, number, status, operation, date, car_id)
     values ('eeeeeeee-1111-1111-1111-111111111101', 'ОТ-ТЕСТ', 'shipped', 'sale',
             current_date, $1)
     on conflict (id) do update set car_id = excluded.car_id`, [CAR]);

  await pool.query(
    `update line set shipment_doc_id = 'eeeeeeee-1111-1111-1111-111111111101' where id = $1`, [id]);
  return id;
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('БТ п. 18 · экран подбора открывается по праву', () => {
  test('кладовщику — можно: он и опознаёт деталь', async () => {
    const { status, body } = await html('/returns/find', asStore);
    expect(status).toBe(200);
    expect(body).toContain('data-testid="page-returns-find"');
    expect(body).toContain('data-testid="find-form"');
  });

  test('менеджеру — можно: БТ говорит «как менеджер, так и кладовщик»', async () => {
    expect((await html('/returns/find', asManager)).status).toBe(200);
  });

  test('механику — нельзя, и причина названа', async () => {
    const { status, body } = await html('/returns/find', asMechanic);
    expect(status, 'механик открыл экран возвратов').toBe(403);
    expect(body).toContain('return.create');
  });

  test('в панели есть поле на каждый признак опознания', async () => {
    const { body } = await html('/returns/find', asStore);
    for (const f of ['plate', 'name', 'article', 'customer', 'dateFrom', 'dateTo']) {
      expect(body, `нет поля «${f}»`).toContain(`data-testid="find-${f}"`);
    }
  });

  test('вход в подбор есть на экране возвратов — иначе его не найдут', async () => {
    // Кладовщик приходит с деталью в руках и не знает номера возврата. Не покажи мы
    // вход, он пошёл бы искать строку в общем списке — то есть делать работу дважды.
    const { body } = await html('/documents/returns', asStore);
    expect(body, 'ссылки на подбор нет на экране возвратов').toContain('data-testid="find-link"');
    expect(body).toContain('/returns/find');
  });

  test('ссылка только на возвратах — в отгрузках её быть не должно', async () => {
    const { body } = await html('/documents/shipments', asStore);
    expect(body, 'ссылка на подбор возврата стоит среди отгрузок').not.toContain('find-link');
  });
});

describe('БТ п. 18 · что попадает в подбор', () => {
  test('ПРОДАННОЕ показывается', async () => {
    const id = await soldLine();
    const { body } = await html('/returns/find', asStore);
    expect(body, 'проданной строки нет в подборе').toContain(`data-testid="found-${id}"`);
  });

  test('НЕпроданное НЕ показывается — вернуть можно только уехавшее', async () => {
    const id = await soldLine();
    await pool.query(`update line set status = 'new' where id = $1`, [id]);

    const { body } = await html('/returns/find', asStore);
    expect(body, 'в подбор попало непроданное').not.toContain(`data-testid="found-${id}"`);
  });

  test('уже возвращённое не показывается — второй раз не вернуть', async () => {
    const id = await soldLine();
    await pool.query(
      `insert into return_order (id, number, kind, status, operation)
       values ('eeeeeeee-2222-2222-2222-222222222202', 'ВЗ-ТЕСТ', 'client', 'new', 'sale')`);
    await pool.query(
      `update line set return_id = 'eeeeeeee-2222-2222-2222-222222222202' where id = $1`, [id]);

    const { body } = await html('/returns/find', asStore);
    expect(body, 'возвращённая строка снова в подборе').not.toContain(`data-testid="found-${id}"`);
  });

  test('пустой результат объясняется словами и предупреждает о непроданном', async () => {
    await soldLine();
    const { body } = await html('/returns/find?plate=НЕТТАКОГО', asStore);
    expect(body).toContain('data-testid="find-empty"');
    // Кладовщик должен понять, ПОЧЕМУ не нашлось, а не искать вслепую.
    expect(body, 'нет объяснения про непроданное').toContain('не продавалась');
  });
});

describe('БТ п. 18 · поиск по признакам опознания', () => {
  test('по ГОС. НОМЕРУ — главный признак: деталь опознают по машине', async () => {
    const id = await soldLine({ plate: 'Х999УУ99' });
    const { body } = await html('/returns/find?plate=Х999УУ99', asStore);
    expect(body).toContain(`data-testid="found-${id}"`);

    const other = await html('/returns/find?plate=А000АА00', asStore);
    expect(other.body).not.toContain(`data-testid="found-${id}"`);
  });

  test('по НАИМЕНОВАНИЮ — подстрока, без учёта регистра', async () => {
    await soldLine({ name: 'Патрубок радиатора' });
    const lower = await html('/returns/find?name=патрубок', asStore);
    const upper = await html('/returns/find?name=ПАТРУБОК', asStore);
    expect(lower.body).toContain('Патрубок радиатора');
    expect(upper.body).toContain('Патрубок радиатора');
  });

  test('по АРТИКУЛУ', async () => {
    await soldLine();
    const { body } = await html('/returns/find?article=FLT-OIL', asStore);
    expect(body, 'поиск по артикулу ничего не дал').toContain('FLT-OIL-001');
  });

  test('`%` и `_` в запросе — символы, а не шаблоны', async () => {
    await soldLine();
    // Запрос из одних шаблонов не должен вернуть весь список.
    const { body } = await html('/returns/find?name=%25', asStore);
    expect(body, 'шаблон LIKE не экранирован').toContain('data-testid="find-empty"');
  });

  test('пустые поля не считаются условиями', async () => {
    const id = await soldLine();
    const { body } = await html('/returns/find?plate=&name=&article=', asStore);
    expect(body, 'пустые поля сузили выдачу').toContain(`data-testid="found-${id}"`);
  });
});

describe('БТ п. 18 · оформление возврата по найденному', () => {
  test('отмеченная деталь создаёт возврат клиента', async () => {
    const id = await soldLine();
    const before = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from return_order`)).rows[0]!.n);

    const r = await uiPost('/ui/returns/from-found', { lineId: [id] }, asStore);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('data-testid="find-done"');

    const after = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from return_order`)).rows[0]!.n);
    expect(after, 'возврат не создан').toBe(before + 1);

    const linked = await pool.query<{ return_id: string | null }>(
      `select return_id from line where id = $1`, [id]);
    expect(linked.rows[0]!.return_id, 'строка не привязана к возврату').toBeTruthy();
  });

  test('возврат записывает АВТОРА — опознал конкретный кладовщик', async () => {
    const id = await soldLine();
    await uiPost('/ui/returns/from-found', { lineId: [id] }, asStore);

    const r = await pool.query<{ author_id: string | null }>(
      `select author_id from return_order order by created_at desc limit 1`);
    expect(r.rows[0]!.author_id, 'автор возврата не записан').toBe(store);
  });

  test('несколько деталей — один возврат', async () => {
    const first = await soldLine();
    // В сиде happy ОДНА строка — вторую заводим: проверяем, что две детали дают
    // ОДИН возврат, а не два документа.
    await pool.query(
      `insert into line (id, operation, status, quantity, order_date, nomenclature_id,
                         shipment_doc_id, customer_id)
       values ('eeeeeeee-4444-4444-4444-444444444401', 'sale', 'shipped', 1, current_date,
               $1, 'eeeeeeee-1111-1111-1111-111111111101',
               '66666666-6666-6666-6666-666666666601')`, [NOM]);
    const second = 'eeeeeeee-4444-4444-4444-444444444401';
    await pool.query(
      `insert into line_fact (id, fact_name) values ($1, 'Вторая деталь')`, [second]);
    await pool.query(
      `insert into line_mark (id, marked) values ($1, false) on conflict (id) do nothing`,
      [second]);

    const before = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from return_order`)).rows[0]!.n);
    await uiPost('/ui/returns/from-found', { lineId: [first, second] }, asStore);
    const after = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from return_order`)).rows[0]!.n);

    expect(after, 'на каждую деталь создался свой возврат').toBe(before + 1);
  });

  test('без отметок — подсказка, а не ошибка', async () => {
    await soldLine();
    const r = await uiPost('/ui/returns/from-found', {}, asStore);
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('data-testid="find-nothing-marked"');
  });

  test('механик возврат не оформит', async () => {
    const id = await soldLine();
    const r = await uiPost('/ui/returns/from-found', { lineId: [id] }, asMechanic);
    expect(r.status).toBe(403);
  });
});

describe('БТ п. 18 · право на возврат появилось у API', () => {
  test('POST /returns теперь под стражей — раньше её не было ВООБЩЕ', async () => {
    const id = await soldLine();
    await pool.query(
      `update line_mark set marked = (id = $1) where id in (select id from line_mark)`, [id]);
    await pool.query(
      `insert into line_mark (id, marked) values ($1, true)
       on conflict (id) do update set marked = true`, [id]);

    const denied = await request('/returns', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: asMechanic },
      body: JSON.stringify({ kind: 'client' }),
    });
    expect(denied.status, 'механик оформил возврат').toBe(403);
  });

  test('кладовщик и менеджер возврат оформляют', async () => {
    for (const [who, cookie] of [['кладовщик', asStore], ['менеджер', asManager]] as const) {
      await seedExtra.clear();
      await seedProcess('happy');
      const id = await soldLine();
      await pool.query(
        `insert into line_mark (id, marked) values ($1, true)
         on conflict (id) do update set marked = true`, [id]);

      const r = await request('/returns', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ kind: 'client' }),
      });
      expect(r.status, `${who} не смог оформить возврат`).toBe(201);
    }
  });
});
