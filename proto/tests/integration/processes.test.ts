import { beforeEach, describe, expect, test } from 'bun:test';
import { pool } from '../../src/db.ts';
import { processIds, resetTo, seedRefs } from '../../db/seed.ts';
import { allowedFrom } from '../../src/domain/transition.ts';
import { STATUSES } from '../../src/domain/status.ts';

// Гейт этапа 4: у КАЖДОГО из 11 процессов есть воспроизводимое начальное состояние,
// и из него есть хотя бы один допустимый переход.
//
// Смысл проверки: процесс, который нельзя начать, — это не «недоделанный процесс»,
// а невидимая дыра. Оператор откроет АРМ, не найдёт строку и не поймёт, почему.
// В legacy такие дыры закрывали вручную через 1С.

/**
 * Ожидаемое начальное состояние. Выведено из первого узла процесса, а не подогнано
 * под то, что получилось: N1 «Заявка» → new, K3 «Комплектация» → assembly и т.д.
 */
const EXPECTED: Record<string, string> = {
  happy: 'new',
  stock: 'new',
  mixed_order: 'new',
  delivery_split: 'new',
  virtual_buy: 'new',
  defect: 'assembly',
  cancel_supplier: 'ordered',
  return: 'shipped',
  return_mgr: 'return',
  return_internal: 'ready_to_ship',
  car_repair_in: 'new',
};

/** Сколько строк должно быть у процесса. */
const LINE_COUNT: Record<string, number> = {
  mixed_order: 2, // склад + закупка
};

const linesOf = async (): Promise<{ id: string; status: string }[]> => {
  const r = await pool.query<{ id: string; status: string }>(
    `select id, status from line where not deleted order by id`,
  );
  return r.rows;
};

beforeEach(async () => {
  await seedRefs();
});

describe('сиды процессов', () => {
  test('сид есть у всех 11 процессов из модели', async () => {
    const expected = Object.keys(EXPECTED).sort();
    expect(processIds()).toEqual(expected);
    expect(processIds().length).toBe(11);
  });

  test('каждый процесс начинается в объявленном статусе и переход из него возможен', async () => {
    const problems: string[] = [];

    for (const [id, status] of Object.entries(EXPECTED)) {
      await resetTo(id);
      const lines = await linesOf();

      if (lines.length === 0) {
        problems.push(`${id}: нет ни одной строки`);
        continue;
      }
      const actual = lines[0]!.status;
      if (actual !== status) {
        problems.push(`${id}: статус «${actual}», ожидался «${status}»`);
      }
      if (!STATUSES.includes(actual as (typeof STATUSES)[number])) {
        problems.push(`${id}: статус «${actual}» отсутствует в модели`);
      }
      if (allowedFrom(actual).length === 0) {
        problems.push(`${id}: из статуса «${actual}» нет ни одного перехода — процесс не продолжить`);
      }
    }

    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('число строк у процесса соответствует замыслу', async () => {
    for (const [id, count] of Object.entries(LINE_COUNT)) {
      await resetTo(id);
      expect((await linesOf()).length, `${id}: неверное число строк`).toBe(count);
    }
    // У остальных — ровно одна строка.
    for (const id of processIds()) {
      if (LINE_COUNT[id]) continue;
      await resetTo(id);
      expect((await linesOf()).length, `${id}: ожидалась одна строка`).toBe(1);
    }
  });

  test('смешанный заказ: одна строка со склада, вторая — без остатка', async () => {
    await resetTo('mixed_order');
    const lines = await linesOf();
    expect(lines.length).toBe(2);

    // Остаток есть только у первой строки: вторая идёт в закупку.
    const balances = await pool.query<{ n: string }>(
      `select count(*)::text as n from stock_balance where on_hand > 0`,
    );
    expect(Number(balances.rows[0]!.n), 'остаток должен быть ровно по одной номенклатуре').toBe(1);
  });

  test('happy идёт через закупку: остатка нет', async () => {
    await resetTo('happy');
    // Точное сравнение, а не LIKE: `line_id` имеет тип uuid, и Postgres отвечает
    // «operator does not exist: uuid ~~ unknown» (проверено).
    const r = await pool.query(`select 1 from stock_move where line_id = $1`, [
      'b0000000-0000-0000-0000-000000000001',
    ]);
    expect(r.rowCount, 'у happy не должно быть остатка').toBe(0);
  });

  test('stock идёт через резерв: остаток есть', async () => {
    await resetTo('stock');
    const r = await pool.query<{ on_hand: string }>(
      `select on_hand from stock_balance where nomenclature_id = '77777777-7777-7777-7777-777777777707'`,
    );
    expect(Number(r.rows[0]!.on_hand)).toBe(10);
  });

  test('ремонт: к процессу привязан автомобиль и открыт заказ-наряд', async () => {
    await resetTo('car_repair_in');
    const wo = await pool.query<{ n: string }>(`select count(*)::text as n from work_order`);
    expect(Number(wo.rows[0]!.n), 'заказ-наряд не создан').toBe(1);

    const car = await pool.query<{ n: string }>(`select count(*)::text as n from car`);
    expect(Number(car.rows[0]!.n)).toBeGreaterThan(0);
  });

  test('сброс на процесс не оставляет данных предыдущего', async () => {
    await resetTo('return');
    const shipped = await linesOf();
    expect(shipped.length).toBe(1);

    await resetTo('happy');
    const happyLines = await linesOf();
    expect(happyLines.length, 'строки предыдущего процесса остались').toBe(1);
    expect(happyLines[0]!.status).toBe('new');
  });

  test('каждый процесс виден через представление', async () => {
    for (const id of processIds()) {
      await resetTo(id);
      const r = await pool.query<{ n: string }>(`select count(*)::text as n from line_view`);
      expect(Number(r.rows[0]!.n), `${id}: строк нет в line_view`).toBeGreaterThan(0);
    }
  });
});
