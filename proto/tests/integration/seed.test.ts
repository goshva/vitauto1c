import { describe, expect, test } from 'bun:test';
import { pool } from '../../src/db.ts';
import { processIds, seedProcess, seedRefs } from '../../db/seed.ts';

// Гейт этапа 1 (prototype-spec.md §2.3): сид воспроизводим.
//
// Смысл проверки: тест N+1 должен видеть ровно то, что оставил сид, а не тест N.
// В legacy этого не было — отсюда «6 чужих отметок» между прогонами и 12 пунктов
// в manual.md §6, которые нельзя было покрыть, «потому что нужны данные».
//
// Сид меняет базу осознанно: он И ЕСТЬ каноническое состояние. Идемпотентность
// означает, что повторный запуск не накапливает данные.

const count = async (table: string): Promise<number> => {
  const r = await pool.query<{ n: string }>(`select count(*)::text as n from ${table}`);
  return Number(r.rows[0]!.n);
};

const HAPPY_LINE = 'b0000000-0000-0000-0000-000000000001';
const STOCK_LINE = 'b0000000-0000-0000-0000-000000000002';

describe('справочники', () => {
  test('применяются и дают объявленное число строк', async () => {
    await seedRefs();
    expect(await count('nomenclature')).toBe(8);
    expect(await count('counterparty')).toBe(5);
    expect(await count('unit')).toBe(2);
    expect(await count('contract')).toBe(2);
    expect(await count('organization')).toBe(1);
    expect(await count('warehouse')).toBe(1);
    expect(await count('warehouse_zone')).toBe(12);
    expect(await count('storage_cell')).toBe(12);
    expect(await count('payment_form')).toBe(2);
    expect(await count('service_kind')).toBe(2);
    expect(await count('batch')).toBe(2);
    expect(await count('car')).toBe(1);
    expect(await count('car_attribute')).toBe(7);
  });

  test('идемпотентны: повторный запуск не удваивает строки', async () => {
    await seedRefs();
    const first = await count('nomenclature');
    await seedRefs();
    expect(await count('nomenclature')).toBe(first);
  });
});

describe('сиды процессов', () => {
  test('есть сиды happy и stock', () => {
    expect(processIds()).toContain('happy');
    expect(processIds()).toContain('stock');
  });

  test('happy: одна строка в new, без остатка — путь идёт через закупку', async () => {
    await seedRefs();
    await seedProcess('happy');

    const r = await pool.query<{ status: string; quantity: string }>(
      `select status, quantity::text from line where id = $1`,
      [HAPPY_LINE],
    );
    expect(r.rowCount, 'строка happy не создана').toBe(1);
    expect(r.rows[0]!.status).toBe('new');

    const stock = await pool.query(`select 1 from stock_move where line_id = $1`, [HAPPY_LINE]);
    expect(stock.rowCount, 'у happy не должно быть остатка — он идёт через закупку').toBe(0);
  });

  test('stock: одна строка в new И остаток на складе — путь идёт через резерв', async () => {
    await seedRefs();
    await seedProcess('stock');

    const r = await pool.query<{ status: string }>(`select status from line where id = $1`, [STOCK_LINE]);
    expect(r.rowCount, 'строка stock не создана').toBe(1);
    expect(r.rows[0]!.status).toBe('new');

    const bal = await pool.query<{ on_hand: string }>(
      `select on_hand from stock_balance
        where nomenclature_id = '77777777-7777-7777-7777-777777777707'
          and warehouse_id = '44444444-4444-4444-4444-444444444401'`,
    );
    expect(Number(bal.rows[0]!.on_hand), 'остаток stock не появился').toBe(10);
  });

  test('идемпотентны: повторный запуск не удваивает строки', async () => {
    await seedRefs();
    await seedProcess('happy');
    const first = await count('line');
    await seedProcess('happy');
    expect(await count('line')).toBe(first);
  });

  test('повторный запуск сбрасывает отметки, поставленные тестом', async () => {
    await seedRefs();
    await seedProcess('happy');
    await pool.query(`update line_mark set marked = true where id = $1`, [HAPPY_LINE]);
    await seedProcess('happy');

    const r = await pool.query<{ marked: boolean }>(`select marked from line_mark where id = $1`, [HAPPY_LINE]);
    expect(r.rows[0]!.marked, 'сид обязан сбрасывать отметки').toBe(false);
  });

  test('неизвестный процесс — понятная ошибка, а не молчаливый пропуск', async () => {
    await expect(seedProcess('нетакого')).rejects.toThrow(/нет сида процесса/);
  });
});

describe('сид виден через представления', () => {
  test('line_view показывает строку happy вместе с фактом заявки', async () => {
    await seedRefs();
    await seedProcess('happy');
    const r = await pool.query<{ factName: string; status: string; quantity: string }>(
      `select "factName", "status", "quantity" from line_view where "clientOrderNumber" = 'ЗК-HAPPY-1'`,
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0]!.factName).toBe('Фильтр масляный');
    expect(r.rows[0]!.status).toBe('new');
  });

  test('line_totals считает суммы засеянной строки', async () => {
    await seedRefs();
    await seedProcess('stock');
    const r = await pool.query<{ sale_sum: string }>(
      `select sale_sum from line_totals where line_id = $1`,
      [STOCK_LINE],
    );
    // quantity = 2, sale_price ещё не задан → сумма 0, но строка есть
    expect(r.rowCount).toBe(1);
  });
});
