import { beforeEach, describe, expect, test } from 'bun:test';
import { pool } from '../../src/db.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { PROCESSES } from '../../src/domain/process-map.ts';

// Гейт витрины: по строке на КАЖДЫЙ этап КАЖДОГО процесса.
//
// Смысл проверки: витрина обязана покрывать ВСЕ состояния модели, иначе карта
// процессов останется «живой» лишь на части шагов — а ровно за этим её и делали.
// Тест сверяется с моделью, а не с числом, случайно получившимся при генерации.

/** Пары «процесс × состояние» из карты процессов. */
const PAIRS = PROCESSES.flatMap((p) =>
  [...new Set(p.steps.map((s) => s.status).filter((s): s is string => Boolean(s)))]
    .map((status) => ({ process: p.id, status })),
);

const count = async (table: string): Promise<number> =>
  Number((await pool.query<{ n: string }>(`select count(*)::text n from ${table}`)).rows[0]!.n);

beforeEach(async () => {
  await seedRefs();
  // Чистый старт: строка сида happy сдвинула бы счёт «61» на «62».
  await seedExtra.clear();
});

describe('витрина: покрытие этапов', () => {
  test('строк ровно столько, сколько пар «процесс × состояние»', async () => {
    await seedExtra.showcase();
    expect(await count('line'), `пар в модели: ${PAIRS.length}`).toBe(PAIRS.length);
  });

  test('каждое состояние модели заполнено хотя бы одной строкой', async () => {
    await seedExtra.showcase();
    const r = await pool.query<{ status: string; n: string }>(
      `select status, count(*)::text n from line group by status`,
    );
    const have = new Map(r.rows.map((x) => [x.status, Number(x.n)]));

    const needed = [...new Set(PAIRS.map((p) => p.status))].sort();
    const missing = needed.filter((s) => !have.has(s));
    expect(missing, `состояния без строк: ${missing.join(', ')}`).toEqual([]);
  });

  test('у каждого процесса есть строки на всех его состояниях', async () => {
    await seedExtra.showcase();
    const problems: string[] = [];

    for (const p of PROCESSES) {
      const statuses = [...new Set(p.steps.map((s) => s.status).filter(Boolean))] as string[];
      if (statuses.length === 0) continue;

      // Витрина не помечает строки процессом, поэтому сверяем по номерам:
      // каждый процесс пишет свои номера с префиксом ВИТ-<ПРОЦЕСС>-.
      const r = await pool.query<{ status: string }>(
        `select distinct status from line where internal_order_number like $1`,
        [`ВИТ-${p.id.toUpperCase().slice(0, 8)}-%`],
      );
      const have = new Set(r.rows.map((x) => x.status));
      const missing = statuses.filter((s) => !have.has(s));
      if (missing.length) problems.push(`${p.id}: нет строк в ${missing.join(', ')}`);
    }

    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('идемпотентна: повторный прогон не удваивает строки', async () => {
    await seedExtra.showcase();
    const first = await count('line');
    await seedExtra.showcase();
    expect(await count('line')).toBe(first);
  });

  test('витрина не трогает строки процессов', async () => {
    await seedProcess('happy');
    const before = await count('line');
    await seedExtra.showcase();
    // Строка сида happy осталась, витринные добавились.
    expect(await count('line')).toBe(before + PAIRS.length);
  });
});

describe('витрина: необходимые сущности', () => {
  test('у каждой строки есть заказ и факт заявки', async () => {
    await seedExtra.showcase();
    expect(await count('customer_order')).toBe(PAIRS.length);
    expect(await count('line_fact')).toBe(PAIRS.length);
  });

  test('документы созданы там, где состояние их подразумевает', async () => {
    await seedExtra.showcase();

    // Состояния, из которых строка уже прошла закупку, имеют заказ поставщику.
    const withSupplier = ['ordered', 'paid', 'in_transit', 'acceptance', 'to_stock',
      'reserve', 'assembly', 'ready_to_ship', 'shipped', 'closed', 'return'];
    const expectedSupplier = PAIRS.filter((p) => withSupplier.includes(p.status)).length;
    expect(await count('supplier_order')).toBe(expectedSupplier);

    // Отгрузка — только у отгруженных и закрытых.
    const expectedShipment = PAIRS.filter((p) => ['shipped', 'closed'].includes(p.status)).length;
    expect(await count('shipment')).toBe(expectedShipment);

    // Возврат — один, у состояния return.
    expect(await count('return_order')).toBe(PAIRS.filter((p) => p.status === 'return').length);
  });

  test('остаток ненулевой там, где товар на складе', async () => {
    await seedExtra.showcase();
    // Список — из модели, а не по памяти: 'to_stock' в шагах процессов отсутствует.
    const onStock = ['acceptance', 'assembly', 'ready_to_ship', 'reserve', 'return'];
    const inModel = new Set(PAIRS.map((x) => x.status));
    expect(onStock.filter((s) => !inModel.has(s)), 'ожидание не из модели').toEqual([]);

    const r = await pool.query<{ status: string; on_hand: string }>(
      `select l.status, coalesce(sum(sb.on_hand), 0)::text on_hand
         from line l
         left join stock_balance sb on sb.nomenclature_id = l.nomenclature_id
              and sb.warehouse_id = l.warehouse_id
        group by l.status`,
    );
    const byStatus = new Map(r.rows.map((x) => [x.status, Number(x.on_hand)]));

    const empty = onStock.filter((s) => (byStatus.get(s) ?? 0) <= 0);
    expect(empty, `нет остатка в состояниях: ${empty.join(', ')}`).toEqual([]);
  });
});
