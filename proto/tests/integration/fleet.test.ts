import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// API автопарка (Q2). Тест написан ДО реализации.
//
// Главное: список ТО должен быть НЕПУСТЫМ на сиде и объяснять ПРИЧИНУ по каждой
// машине. Список без причины бесполезен — механик не знает, что делать.

const CAR_DUE_DAYS = 'cccccccc-cccc-cccc-cccc-cccccccccc01';   // год с ТО истёк
const CAR_OK = 'cccccccc-cccc-cccc-cccc-cccccccccc02';          // всё в порядке
const CAR_DUE_KM = 'cccccccc-cccc-cccc-cccc-cccccccccc03';      // 12 000 км сверх
const CAR_NEVER = 'cccccccc-cccc-cccc-cccc-cccccccccc04';       // ТО не делали
const DEPT_TC = 'dddddddd-dddd-dddd-dddd-dddddddddd01';

const json = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const get = (url: string) => json(url, { headers: { accept: 'application/json' } });
const patch = (url: string, body: unknown) =>
  json(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
});

describe('GET /fleet — список ТС', () => {
  test('отдаёт весь автопарк со статусом и пробегом', async () => {
    const { status, body } = await get('/fleet');
    expect(status).toBe(200);

    const items = body.items as { code: string; mileage: number; status: string; statusTitle: string }[];
    expect(items.length).toBe(4);
    expect(items[0]!.code).toBe('АВТ-001');
    // Состояние — словами для оператора, а не машинным кодом.
    expect(items.find((x) => x.code === 'АВТ-003')!.statusTitle).toBe('В ремонте');
  });

  test('видно подразделение и госномер из атрибутов', async () => {
    const { body } = await get('/fleet');
    const items = body.items as { code: string; department: string | null; plate: string | null }[];
    const first = items.find((x) => x.code === 'АВТ-001')!;
    expect(first.department).toBe('Транспортный цех');
    expect(first.plate).toBe('А123ВС777');
  });

  test('фильтр по подразделению', async () => {
    const all = await get('/fleet');
    const tc = await get(`/fleet?departmentId=${DEPT_TC}`);

    expect((tc.body.items as unknown[]).length).toBe(2);
    expect((tc.body.items as unknown[]).length).toBeLessThan((all.body.items as unknown[]).length);
  });

  test('фильтр по состоянию: в ремонте только одна машина', async () => {
    const { body } = await get('/fleet?status=in_repair');
    const items = body.items as { code: string }[];
    expect(items.length).toBe(1);
    expect(items[0]!.code).toBe('АВТ-003');
  });
});

describe('GET /fleet/{id} — карточка ТС', () => {
  test('отдаёт историю обслуживания и остаток до ТО', async () => {
    const { status, body } = await get(`/fleet/${CAR_DUE_KM}`);
    expect(status).toBe(200);

    const car = body.car as { code: string; mileage: number };
    expect(car.code).toBe('АВТ-003');
    expect(car.mileage).toBe(131000);

    const due = body.maintenance as { due: boolean; reason: string; remainingKm: number };
    expect(due.due).toBe(true);
    expect(due.reason).toBe('mileage');
    expect(due.remainingKm).toBeLessThan(0);
  });

  test('история нарядов по машине (пустая, пока нарядов нет)', async () => {
    const { body } = await get(`/fleet/${CAR_OK}`);
    expect(Array.isArray(body.workOrders)).toBe(true);
  });

  test('просроченное по СРОКУ: причина «days», а не «mileage»', async () => {
    // АВТ-001 проехала с последнего ТО только 5 000 км при интервале 10 000 —
    // по пробегу она не должна. Поднимает её календарь.
    const { body } = await get(`/fleet/${CAR_DUE_DAYS}`);
    const due = body.maintenance as { due: boolean; reason: string; remainingDays: number; remainingKm: number };

    expect(due.due).toBe(true);
    expect(due.reason).toBe('days');
    expect(due.remainingDays).toBeLessThan(0);
    expect(due.remainingKm, 'по пробегу ещё есть запас').toBeGreaterThan(0);
  });

  test('несуществующая машина → 404', async () => {
    const { status } = await get('/fleet/00000000-0000-0000-0000-0000000000ff');
    expect(status).toBe(404);
  });
});

describe('GET /maintenance — что пора обслуживать', () => {
  test('три машины из четырёх требуют ТО, и у каждой названа причина', async () => {
    const { status, body } = await get('/maintenance');
    expect(status).toBe(200);

    const items = body.items as { code: string; reason: string; reasonTitle: string }[];
    expect(items.length, 'список ТО пуст — на сиде он обязан быть непустым').toBe(3);

    const byCode = new Map(items.map((x) => [x.code, x]));
    expect(byCode.get('АВТ-001')!.reason).toBe('days');
    expect(byCode.get('АВТ-003')!.reason).toBe('mileage');
    expect(byCode.get('АВТ-004')!.reason).toBe('never');
    // Машина, у которой всё в порядке, в список не попадает.
    expect(byCode.has('АВТ-002')).toBe(false);

    for (const x of items) expect(x.reasonTitle, 'причина не переведена на русский').toBeTruthy();
  });

  test('есть подсказка, сколько осталось до ТО', async () => {
    const { body } = await get('/maintenance');
    const items = body.items as { code: string; remainingKm: number | null; remainingDays: number | null }[];
    const km = items.find((x) => x.code === 'АВТ-003')!;
    // Остаток считается от точки отсчёта: 10 000 − (131 000 − 119 000) = −2 000,
    // то есть 2 000 км сверх интервала. Пробег 131 000 сам по себе ничего не значит —
    // важен пробег С МОМЕНТА ПОСЛЕДНЕГО ТО.
    expect(km.remainingKm).toBe(-2000);
  });

  test('списанная машина в список ТО не попадает', async () => {
    await patch(`/fleet/${CAR_NEVER}`, { status: 'written_off' });
    const { body } = await get('/maintenance');
    const codes = (body.items as { code: string }[]).map((x) => x.code);
    expect(codes).not.toContain('АВТ-004');
  });
});

describe('PATCH /fleet/{id} — пробег и состояние', () => {
  test('пробег обновляется и меняет картину ТО', async () => {
    // АВТ-002 не требует ТО: точка отсчёта 40 000, интервал 10 000 — предел 50 000.
    // Накатываем 6 000 (до 51 000) — машина становится должна.
    const before = await get('/maintenance');
    expect((before.body.items as { code: string }[]).map((x) => x.code)).not.toContain('АВТ-002');

    const { status, body } = await patch(`/fleet/${CAR_OK}`, { mileage: 51000 });
    expect(status).toBe(200);
    expect(body.mileage).toBe(51000);

    const after = await get('/maintenance');
    expect((after.body.items as { code: string }[]).map((x) => x.code)).toContain('АВТ-002');
  });

  test('пробег не может уменьшиться — это скрутка счётчика', async () => {
    const { status, body } = await patch(`/fleet/${CAR_OK}`, { mileage: 1000 });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('меньше');

    const r = await pool.query<{ mileage: number }>(`select mileage from car where id = $1`, [CAR_OK]);
    expect(r.rows[0]!.mileage, 'скрутка всё-таки прошла').toBe(45000);
  });

  test('выполненное ТО фиксирует точку отсчёта', async () => {
    const { status } = await patch(`/fleet/${CAR_DUE_KM}`, { serviceDone: true });
    expect(status).toBe(200);

    const r = await pool.query<{ mileage_at_service: number; last_service_at: Date }>(
      `select mileage_at_service, last_service_at from car where id = $1`, [CAR_DUE_KM]);
    expect(r.rows[0]!.mileage_at_service, 'точка отсчёта не сдвинулась').toBe(131000);
    expect(r.rows[0]!.last_service_at).toBeTruthy();

    // После ТО машина уходит из списка.
    const { body } = await get('/maintenance');
    expect((body.items as { code: string }[]).map((x) => x.code)).not.toContain('АВТ-003');
  });

  test('неизвестное состояние отвергается со списком допустимых', async () => {
    const { status, body } = await patch(`/fleet/${CAR_OK}`, { status: 'летает' });
    expect(status).toBe(400);
    expect(String(body.message)).toContain('on_line');
  });

  test('пустое тело отвергается — нечего менять', async () => {
    const { status } = await patch(`/fleet/${CAR_OK}`, {});
    expect(status).toBe(400);
  });
});
