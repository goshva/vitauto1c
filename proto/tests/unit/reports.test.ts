import { describe, expect, test } from 'bun:test';
import { byMonth, totals, totalsBy, type SaleRow } from '../../src/domain/reports.ts';

// Расчёты отчётности. ОТВЕТЫ СЧИТАНЫ ВРУЧНУЮ, а не сняты с того же кода: сверка отчёта
// с самим собой ничего не проверяет. Цифра в отчёте — то место, где ошибку замечают
// поздно и верят ей заранее.
//
// ОТДЕЛЬНО ПРОВЕРЯЕТСЯ УБЫТОК. Отчёт, который прячет продажу ниже себестоимости или
// берёт модуль процента, опаснее отсутствующего: по нему принимают решения.

const sale = (o: Partial<SaleRow> = {}): SaleRow => ({
  quantity: 1,
  costPrice: 100,
  salePrice: 150,
  customer: 'ИП Иванов',
  nomenclature: 'Фильтр масляный',
  shippedAt: new Date('2026-08-10'),
  status: 'closed',
  ...o,
});

describe('отчёты · итоги', () => {
  test('простой случай: 3 штуки по 150 при себестоимости 100', () => {
    // Выручка 450, себестоимость 300, прибыль 150, наценка 50 %.
    const t = totals([sale({ quantity: 3 })]);
    expect(t.units).toBe(3);
    expect(t.revenue).toBe(450);
    expect(t.cost).toBe(300);
    expect(t.profit).toBe(150);
    expect(t.markupPct).toBe(50);
    expect(t.lossLines).toBe(0);
  });

  test('НАЦЕНКА СЧИТАЕТСЯ ОТ СЕБЕСТОИМОСТИ, как в БТ п. 1', () => {
    // Себестоимость 100, цена 200: наценка 100 %. От выручки было бы 50 %.
    const t = totals([sale({ costPrice: 100, salePrice: 200 })]);
    expect(t.markupPct, 'наценку посчитали от выручки, а не от себестоимости').toBe(100);
  });

  test('УБЫТОК ВИДЕН и наценка отрицательная', () => {
    // Продали за 90 то, что стоило 100. Наценка -10 %, и это надо показать.
    const t = totals([sale({ costPrice: 100, salePrice: 90 })]);
    expect(t.profit, 'убыток спрятан').toBe(-10);
    expect(t.markupPct, 'наценка взята по модулю').toBe(-10);
    expect(t.lossLines, 'убыточная строка не посчитана').toBe(1);
  });

  test('убыточные строки считаются отдельно от прибыльных', () => {
    const t = totals([
      sale({ costPrice: 100, salePrice: 200 }),   // +100
      sale({ costPrice: 100, salePrice: 50 }),    // -50
      sale({ costPrice: 100, salePrice: 300 }),   // +200
    ]);
    expect(t.profit).toBe(250);
    expect(t.lossLines).toBe(1);
  });

  test('себестоимость неизвестна: выручка есть, прибыли нет', () => {
    // Выбросить строку целиком — занизить выручку. Посчитать с нулевой себестоимостью —
    // показать ложную прибыль. Считаем выручку, прибыль — только по известным.
    const t = totals([sale({ costPrice: null, salePrice: 150, quantity: 2 })]);
    expect(t.revenue, 'выручка потеряна вместе с себестоимостью').toBe(300);
    expect(t.cost).toBe(0);
    expect(t.profit, 'прибыль выдумана при неизвестной себестоимости').toBe(300);
    expect(t.markupPct, 'наценка посчитана при нулевой себестоимости').toBe(null);
  });

  test('цена не проставлена: в выручку не идёт, количество считается', () => {
    const t = totals([sale({ salePrice: null, quantity: 4 })]);
    expect(t.revenue).toBe(0);
    expect(t.units, 'количество потеряно').toBe(4);
  });

  test('деления на ноль нет: нулевая себестоимость даёт пустую наценку', () => {
    const t = totals([sale({ costPrice: 0, salePrice: 100 })]);
    expect(t.markupPct, 'показали бесконечность вместо пустоты').toBe(null);
  });

  test('пустой набор не ломает расчёт', () => {
    const t = totals([]);
    expect(t).toEqual({
      lines: 0, units: 0, revenue: 0, cost: 0, profit: 0, markupPct: null, lossLines: 0,
    });
  });

  test('копейки не теряются при сложении', () => {
    // 0.1 + 0.2 в двоичной дроби даёт 0.30000000000000004 — округляем до копеек.
    const t = totals([
      sale({ quantity: 1, costPrice: 0.1, salePrice: 0.2 }),
      sale({ quantity: 1, costPrice: 0.2, salePrice: 0.1 }),
    ]);
    expect(t.revenue).toBe(0.3);
    expect(t.cost).toBe(0.3);
  });

  test('число строк в итоге — это число строк, а не штук', () => {
    const t = totals([sale({ quantity: 5 }), sale({ quantity: 7 })]);
    expect(t.lines).toBe(2);
    expect(t.units).toBe(12);
  });
});

describe('отчёты · разрезы', () => {
  test('по заказчикам, дороже первым', () => {
    const rows = [
      sale({ customer: 'ИП Иванов', salePrice: 1000 }),
      sale({ customer: 'АвтоЛюкс', salePrice: 5000 }),
      sale({ customer: 'АвтоЛюкс', salePrice: 1000 }),
    ];
    const r = totalsBy(rows, (x) => x.customer);
    expect(r.map((x) => x.key), 'разрез не отсортирован по выручке')
      .toEqual(['АвтоЛюкс', 'ИИ Иванов'].map((s) => s.replace('ИИ', 'ИП')));
    expect(r[0]!.totals.revenue).toBe(6000);
    expect(r[1]!.totals.revenue).toBe(1000);
  });

  test('итог по разрезу совпадает с общим: ничего не потеряно и не удвоено', () => {
    const rows = [
      sale({ customer: 'А', salePrice: 100 }),
      sale({ customer: 'Б', salePrice: 200 }),
      sale({ customer: 'А', salePrice: 300 }),
    ];
    const sum = totalsBy(rows, (x) => x.customer).reduce((s, x) => s + x.totals.revenue, 0);
    expect(sum, 'сумма разрезов разошлась с общим итогом').toBe(totals(rows).revenue);
  });

  test('пустое значение попадает в «(не указано)», а не исчезает', () => {
    const rows = [sale({ customer: null, salePrice: 100 })];
    const r = totalsBy(rows, (x) => x.customer);
    expect(r[0]!.key, 'строка без заказчика исчезла из отчёта').toBe('(не указано)');
  });

  test('сортировка по прибыли и по наценке — на выбор', () => {
    const rows = [
      sale({ customer: 'Много', costPrice: 100, salePrice: 110, quantity: 100 }), // прибыль 1000, наценка 10 %
      sale({ customer: 'Дорого', costPrice: 100, salePrice: 300 }),               // прибыль 200, наценка 200 %
    ];
    expect(totalsBy(rows, (x) => x.customer, { sortBy: 'profit' })[0]!.key).toBe('Много');
    expect(totalsBy(rows, (x) => x.customer, { sortBy: 'markup' })[0]!.key).toBe('Дорого');
  });

  test('ограничение списка работает', () => {
    const rows = Array.from({ length: 10 }, (_, i) => sale({ customer: `К${i}` }));
    expect(totalsBy(rows, (x) => x.customer, { limit: 3 }).length).toBe(3);
  });
});

describe('отчёты · по месяцам', () => {
  test('месяцы идут от старых к новым и считаются верно', () => {
    const rows = [
      sale({ shippedAt: new Date('2026-09-05'), salePrice: 200 }),
      sale({ shippedAt: new Date('2026-07-20'), salePrice: 100 }),
      sale({ shippedAt: new Date('2026-09-25'), salePrice: 300 }),
    ];
    const r = byMonth(rows);
    expect(r.map((x) => x.key)).toEqual(['2026-07', '2026-09']);
    expect(r[0]!.totals.revenue).toBe(100);
    expect(r[1]!.totals.revenue).toBe(500);
  });

  test('МЕСЯЦ БЕЗ ПРОДАЖ НЕ ПОКАЗЫВАЕТСЯ НУЛЁМ', () => {
    // Июль и сентябрь есть, август пуст. Ноль в августе означал бы спад, которого не было.
    const rows = [
      sale({ shippedAt: new Date('2026-07-10'), salePrice: 100 }),
      sale({ shippedAt: new Date('2026-09-10'), salePrice: 100 }),
    ];
    const keys = byMonth(rows).map((x) => x.key);
    expect(keys, 'пустой месяц дорисован').toEqual(['2026-07', '2026-09']);
    expect(keys).not.toContain('2026-08');
  });

  test('двузначный месяц и переход через год', () => {
    const r = byMonth([
      sale({ shippedAt: new Date('2026-12-31'), salePrice: 100 }),
      sale({ shippedAt: new Date('2027-01-01'), salePrice: 100 }),
    ]);
    expect(r.map((x) => x.key)).toEqual(['2026-12', '2027-01']);
  });
});
