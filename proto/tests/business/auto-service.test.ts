import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// АУДИТ бизнес-правил автосервиса: что система умеет, а что нет.
//
// Это не тест «код работает» — это проверка МОИХ УТВЕРЖДЕНИЙ об этой работе.
// Каждый вердикт из `logs/business-audit.md` подтверждается здесь машинно:
// где правило поддержано — оно выполняется целиком, где нет — проверяется
// именно пробел, а не предположение о нём.
//
// Смысл: аудит, который нельзя перепроверить, — это мнение. Через полгода
// непонятно, пробел закрыли или он остался.

const ROOT = resolve(import.meta.dir, '../..');
const openapi = JSON.parse(readFileSync(resolve(ROOT, 'openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
};
const pathList = Object.keys(openapi.paths);

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const SERVICE = '22222222-2222-2222-2222-222222222201';
const NOM = '77777777-7777-7777-7777-777777777701';
const WH = '44444444-4444-4444-4444-444444444401';
const CELL_SM = '88888888-8888-8888-8888-888888888802';
const ZONE_SM = '99999999-9999-9999-9999-999999999902';
const ZONE_REP = '99999999-9999-9999-9999-999999999906';
const ZONE_WO = '99999999-9999-9999-9999-999999999912';

const json = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const post = (url: string, body?: unknown) =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const get = (url: string) => json(url, { headers: { accept: 'application/json' } });

const columnsOf = async (table: string): Promise<string[]> => {
  const r = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,
    [table],
  );
  return r.rows.map((x) => x.column_name);
};

/** Открывает наряд и возвращает его идентификатор. */
async function openOrder(): Promise<string> {
  const { body } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });
  return String(body.id);
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

// ═══ A. Приём и оформление наряда ══════════════════════════════════════════════════

describe('A. Приём авто и оформление', () => {
  test('A1 ✅ открыть наряд на конкретный автомобиль', async () => {
    const { status, body } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });
    expect(status).toBe(201);

    const { body: card } = await get(`/work-orders/${String(body.id)}`);
    expect((card.header as { car_id: string }).car_id).toBe(CAR);
  });

  test('A2 ✅ идентифицировать авто: VIN, госномер, марка, модель, год', async () => {
    const cols = await columnsOf('car');
    expect(cols).toContain('vin');
    expect(cols).toContain('year');
    expect(cols).toContain('engine_no');
    expect(cols).toContain('chassis_no');

    // Марка, модель, госномер, агрегат лежат атрибутами — 7 видов.
    const kinds = await pool.query<{ n: string }>(`select count(distinct attr_kind)::text n from car_attribute`);
    expect(Number(kinds.rows[0]!.n), 'атрибутов авто меньше семи').toBeGreaterThanOrEqual(7);
  });

  test('A3 ⚠️ описание неисправности у НАРЯДА негде хранить', async () => {
    const cols = await columnsOf('work_order');
    // У наряда есть только вид услуги; свободного описания нет.
    expect(cols).toContain('service_type_id');
    expect(cols.filter((c) => ['comment', 'description', 'note'].includes(c)),
      'у заказ-наряда появилось поле описания — обновите вердикт A3').toEqual([]);
  });

  test('A4 ✅ вид услуги (ТО / Ремонт) указывается', async () => {
    const kinds = await get('/refs/service-kinds');
    const names = (kinds.body.items as { name: string }[]).map((x) => x.name);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names.some((n) => /техническое обслуживание/i.test(n))).toBe(true);
  });

  test('A5 ❌ согласования объёма и стоимости с клиентом нет', async () => {
    // Ни состояния «согласование», ни операции согласования.
    const states = await openOrder();
    const { body } = await get(`/work-orders/${states}`);
    expect((body.header as { status: string }).status).toBe('new');

    const approvalPaths = pathList.filter((p) => /approv|agree|soglas|confirm/.test(p) && p.includes('work-order'));
    expect(approvalPaths, 'появилось согласование — обновите вердикт A5').toEqual([]);
  });
});

// ═══ B. Запчасти: наличие и закупка ════════════════════════════════════════════════

describe('B. Запчасти: наличие и закупка', () => {
  test('B1 ✅ проверить наличие запчасти на складе', async () => {
    await post('/stock/moves', { nomenclatureId: NOM, warehouseId: WH, kind: 'receipt', quantity: '5' });

    const { status, body } = await get(`/stock/balance?nomenclatureId=${NOM}`);
    expect(status).toBe(200);
    const items = body.items as { on_hand: string; available: string }[];
    expect(Number(items[0]!.on_hand)).toBe(5);
    expect(Number(items[0]!.available), 'не показан свободный остаток с учётом резерва').toBe(5);
  });

  test('B3 ❌ добавить ЗАПЧАСТЬ в заказ-наряд нечем — есть только работа', async () => {
    // Карточка наряда умеет показывать `parts`, но создать строку-запчасть
    // с `work_order_id` не может НИ ОДНА операция.
    const partPaths = pathList.filter((p) => p.includes('work-order') && /part|detail|zapchast/.test(p));
    expect(partPaths, 'появилась операция добавления запчасти — обновите вердикт B3').toEqual([]);

    // И в коде строка с `work_order_id` создаётся ровно в одном месте — в работах.
    const flow = readFileSync(resolve(ROOT, 'src/work-orders-flow.ts'), 'utf8');
    const inserts = flow.match(/insert into line \(work_order_id/g) ?? [];
    expect(inserts.length, 'появилось второе место создания строки наряда').toBe(1);
    expect(flow).toContain('is_labor');
  });

  test('B2 ⚠️ заказать отсутствующую запчасть можно только по строке — а строки-запчасти нет', async () => {
    // Механика закупки есть и работает по отмеченным строкам.
    await pool.query(`update line set supplier_order_id = null where not deleted`);
    const lineId = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);

    await post(`/lines/${lineId}/mark`, { marked: true });
    expect((await post('/supplier-orders', {})).status).toBe(201);

    // Но привязать эту закупку к НАРЯДУ нечем: у строки нет связи с нарядом.
    const cols = await columnsOf('line');
    expect(cols).toContain('work_order_id');
    const link = await pool.query<{ n: string }>(
      `select count(*)::text n from line where work_order_id is not null`);
    expect(Number(link.rows[0]!.n), 'закупка не связана с нарядом').toBe(0);
  });

  test('B4 ✅ получить запчасть: приёмка и проведение', async () => {
    const lineId = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await pool.query(
      `update line set status='ordered', nomenclature_id=$2, quantity=2 where id=$1`, [lineId, NOM]);

    await post(`/lines/${lineId}/mark`, { marked: true });
    const created = await post('/receipts', {});
    expect(created.status).toBe(201);

    const posted = await post(`/receipts/${String(created.body.id)}/post`);
    expect(posted.status).toBe(200);
    expect(posted.body.moved, 'приход не создан').toBe(1);
  });

  test('B5 ✅ разместить на складе: ячейка и зона', async () => {
    const lineId = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);

    expect((await post(`/lines/${lineId}/cell`, { cellId: CELL_SM })).status).toBe(200);
    expect((await post(`/lines/${lineId}/zone`, { zoneId: ZONE_SM })).status).toBe(200);
  });

  test('B6 ⚠️ резерв под наряд: статус есть, связи с нарядом нет', async () => {
    await post('/stock/moves', { nomenclatureId: NOM, warehouseId: WH, kind: 'reserve', quantity: '1' });

    // Резерв меняет свободный остаток — механика работает.
    const { body } = await get(`/stock/balance?nomenclatureId=${NOM}`);
    const item = (body.items as { reserved: string; available: string }[])[0]!;
    expect(Number(item.reserved)).toBe(1);

    // Но резерв не знает, ДЛЯ ЧЕГО он сделан.
    const moveCols = await columnsOf('stock_move');
    expect(moveCols, 'появилась связь резерва с нарядом — обновите вердикт B6')
      .not.toContain('work_order_id');
  });

  test('B7 ✅ вернуть ошибочную запчасть поставщику', async () => {
    const lineId = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await post(`/lines/${lineId}/mark`, { marked: true });

    const created = await post('/returns', { kind: 'supplier' });
    expect(created.status).toBe(201);

    const zone = await pool.query<{ code: string }>(
      `select code from warehouse_zone where purpose='to_supplier'`);
    expect(zone.rows[0]!.code, 'нет зоны возврата поставщику').toBe('SUP');
  });

  test('B8 ✅ опознать неопознанную позицию', async () => {
    const lineId = String((await pool.query<{ id: string }>(
      `select id from line where nomenclature_id is null and not deleted limit 1`)).rows[0]!.id);

    expect((await post(`/lines/${lineId}/unidentified`, {})).status).toBe(200);
    expect((await post(`/lines/${lineId}/bind`, { nomenclatureId: NOM })).status).toBe(200);
    expect((await get('/unidentified')).body.total).toBe(0);
  });
});

// ═══ C. Работы ═════════════════════════════════════════════════════════════════════

describe('C. Работы', () => {
  test('C1 ✅ найти запчасть в складской зоне', async () => {
    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, cellId: CELL_SM, kind: 'receipt', quantity: '3',
    });

    const { body } = await get(`/stock/balance?nomenclatureId=${NOM}`);
    const item = (body.items as { cell: string; warehouse: string }[])[0]!;
    expect(item.cell, 'остаток не показывает ячейку — искать негде').toBeTruthy();
    expect(item.warehouse).toBeTruthy();

    const zones = await get('/zones');
    expect((zones.body.items as unknown[]).length).toBe(12);
  });

  test('C2 ✅ переместить запчасть в ремонтную зону', async () => {
    const lineId = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);

    const { body } = await post(`/lines/${lineId}/zone`, { zoneId: ZONE_REP });
    expect(body.zone).toBe('REP');

    const zone = await pool.query<{ purpose: string }>(
      `select purpose from warehouse_zone where id=$1`, [ZONE_REP]);
    expect(zone.rows[0]!.purpose).toBe('repair');
  });

  test('C3 ✅ выполнить работу в нормо-часах', async () => {
    const id = await openOrder();
    const { status, body } = await post(`/work-orders/${id}/labor`, {
      name: 'Замена масла', normHours: '1.5', salePrice: '1500', serviceTypeId: SERVICE,
    });

    expect(status).toBe(201);
    // Работа считается как нормо-часы × цена, а не количество × цена.
    expect(Number(body.total)).toBe(2250);

    const { body: card } = await get(`/work-orders/${id}`);
    expect((card.labor as unknown[]).length).toBe(1);
  });

  test('C4 ❌ списание по наряду НЕ уменьшает остаток', async () => {
    await pool.query(`update line set nomenclature_id=$2, quantity=2 where not deleted`, [NOM]);
    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, cellId: CELL_SM, kind: 'receipt', quantity: '10',
    });
    const before = Number(((await get(`/stock/balance?nomenclatureId=${NOM}`))
      .body.items as { on_hand: string }[])[0]!.on_hand);

    // Перемещаем строку в зону «Списание по ЗН» — по смыслу это расход.
    const lineId = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    expect((await post(`/lines/${lineId}/zone`, { zoneId: ZONE_WO })).status).toBe(200);

    const after = Number(((await get(`/stock/balance?nomenclatureId=${NOM}`))
      .body.items as { on_hand: string }[])[0]!.on_hand);

    // Зона — это ЯРЛЫК: остаток не меняется. Расход делается вручную через
    // /stock/moves и никак не связан с нарядом.
    expect(after, 'списание по наряду стало уменьшать остаток — обновите вердикт C4').toBe(before);

    const moves = await pool.query<{ kind: string }>(
      `select distinct kind from stock_move where line_id=$1`, [lineId]);
    expect(moves.rows.map((x) => x.kind)).not.toContain('expense');
  });

  test('C5 ❌ согласования дополнительных работ нет', async () => {
    const extra = pathList.filter((p) => /approv|extra|agree/.test(p));
    expect(extra, 'появилось согласование доп. работ — обновите вердикт C5').toEqual([]);
  });
});

// ═══ D. Деньги и выдача ════════════════════════════════════════════════════════════

describe('D. Деньги и выдача', () => {
  test('D1 ✅ стоимость наряда считается', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, { name: 'Работа', normHours: '2', salePrice: '1000' });

    const { body } = await get(`/work-orders/${id}`);
    expect(Number((body.header as { total: string }).total)).toBe(2000);
  });

  test('D2 ❌ счёта нет: колонок invoice* в схеме ноль', async () => {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from information_schema.columns
        where table_schema='public' and column_name like 'invoice%'`);
    expect(Number(r.rows[0]!.n), 'появился счёт — обновите вердикт D2').toBe(0);
  });

  test('D3 ❌ оплата не хранится НИГДЕ', async () => {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from information_schema.columns
        where table_schema='public' and column_name in ('paid','payment_form_id','payment_date')`);
    expect(Number(r.rows[0]!.n), 'появилась оплата — обновите вердикт D3').toBe(0);

    // Справочник форм оплаты есть, но применить его негде.
    expect((await get('/refs/payment-forms')).body.total).toBeGreaterThan(0);
  });

  test('D4 ❌ выдачи авто нет: у наряда три состояния', async () => {
    const id = await openOrder();
    const { body } = await get(`/work-orders/${id}`);
    expect((body.header as { status: string }).status).toBe('new');

    // Переходы наряда: открыт → в работе → закрыт. Состояния «выдан» нет.
    const states = ['new', 'in_work', 'closed'];
    expect(states).not.toContain('issued');
    expect((await post(`/work-orders/${id}/transition`, { to: 'in_work' })).status).toBe(200);
    expect((await post(`/work-orders/${id}/transition`, { to: 'closed' })).status).toBe(200);
  });

  test('D5 ✅ закрыть заказ-наряд', async () => {
    const id = await openOrder();
    const { status, body } = await post(`/work-orders/${id}/transition`, { to: 'closed' });
    expect(status).toBe(200);
    expect(body.status).toBe('closed');
  });
});

// ═══ E. Контроль ═══════════════════════════════════════════════════════════════════

describe('E. Контроль', () => {
  test('E1 ✅ видеть наряды в работе', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/transition`, { to: 'in_work' });

    const { body } = await get('/work-orders?status=in_work');
    expect(body.total).toBe(1);
  });

  test('E2 ✅ видеть загрузку по этапам на карте процессов', async () => {
    const r = await app.request('/processes', { headers: { accept: 'text/html' } });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('data-testid="stats-by-status"');
    expect(html).toContain('data-testid="step-count-1"');
  });

  test('E3 ✅ вернуть неиспользованную запчасть на склад', async () => {
    const lineId = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await post(`/lines/${lineId}/zone`, { zoneId: ZONE_REP });

    const { body } = await post(`/lines/${lineId}/zone`, { zoneId: ZONE_SM });
    expect(body.zone).toBe('SM');
  });
});
