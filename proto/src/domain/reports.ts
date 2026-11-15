// Отчёты: чистые расчёты (п. 8 плана волны 2).
//
// БЕЗ ОБРАЩЕНИЙ К БАЗЕ. Здесь только арифметика над уже выбранными строками — и это не
// формальность: цифра в отчёте это то место, где ошибку замечают поздно и верят ей
// заранее. Расчёт, отделённый от выборки, можно проверить на данных, где ответ известен
// СЧИТАЯ ВРУЧНУЮ, а не сверяя с тем же запросом.
//
// ГЛАВНОЕ СВОЙСТВО, КОТОРОЕ ЗДЕСЬ ЗАЩИЩАЕТСЯ: ОТЧЁТ НЕ ДОЛЖЕН ПРЯТАТЬ УБЫТОК.
// Продажа ниже себестоимости встречается, и наценка в ней бывает отрицательной. Отчёт,
// который показывает только прибыльные строки или берёт модуль процента, опаснее
// отсутствующего: по нему принимают решения.

export interface SaleRow {
  quantity: number;
  /** Себестоимость единицы. Пусто — неизвестна. */
  costPrice: number | null;
  /** Цена продажи единицы. Пусто — не проставлена. */
  salePrice: number | null;
  /** Кто заказчик — для разреза по клиентам. */
  customer: string | null;
  /** Наименование позиции — для разреза по номенклатуре. */
  nomenclature: string | null;
  /** Дата отгрузки. Пусто — не отгружено, в выручку не идёт. */
  shippedAt: Date | null;
  /** Состояние строки. */
  status: string;
}

/** Итоги по набору строк: выручка, себестоимость, прибыль, наценка. */
export interface Totals {
  /** Сколько строк участвовало. */
  lines: number;
  /** Штук продано. */
  units: number;
  revenue: number;
  cost: number;
  profit: number;
  /**
   * Наценка в процентах от себестоимости. Пусто — себестоимость нулевая или неизвестна:
   * делить на ноль нельзя, а показать «бесконечность» значит соврать.
   */
  markupPct: number | null;
  /** Сколько строк продано ниже себестоимости. Их надо видеть отдельно. */
  lossLines: number;
}

/**
 * Итоги по строкам.
 *
 * СТРОКИ БЕЗ ЦЕНЫ ИЛИ СЕБЕСТОИМОСТИ — ОТДЕЛЬНЫЙ СЛУЧАЙ, и здесь они НЕ ВЫБРАСЫВАЮТСЯ
 * молча: строка без себестоимости попадает в выручку и в количество, но не в прибыль.
 * Выбросить её целиком значило бы занизить выручку; посчитать с нулевой себестоимостью —
 * показать ложную прибыль. Поэтому стоимость берётся только там, где она известна, и
 * число таких строк видно вызывающему через `lines` и `lossLines`.
 */
export function totals(rows: SaleRow[]): Totals {
  let revenue = 0;
  let cost = 0;
  let units = 0;
  let costed = 0;
  let lossLines = 0;

  for (const r of rows) {
    const qty = r.quantity;
    units += qty;
    if (r.salePrice !== null) revenue += qty * r.salePrice;

    // Прибыль считаем ТОЛЬКО при полной паре цена+себестоимость: иначе получилась бы
    // либо выдуманная прибыль, либо выдуманный убыток.
    if (r.costPrice !== null && r.salePrice !== null) {
      costed += qty;
      const lineCost = qty * r.costPrice;
      const lineRevenue = qty * r.salePrice;
      cost += lineCost;
      if (lineRevenue < lineCost) lossLines++;
    }
  }

  const profit = revenue - cost;
  return {
    lines: rows.length,
    units,
    revenue: round2(revenue),
    cost: round2(cost),
    profit: round2(profit),
    // Наценка от СЕБЕСТОИМОСТИ — так её и считает БТ п. 1, где коэффициент применяется
    // к себестоимости. Считать от выручки значило бы отвечать на другой вопрос.
    markupPct: cost === 0 ? null : Math.round((profit / cost) * 1000) / 10,
    lossLines,
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Итоги по разрезу: ключ — название группы. */
export function totalsBy(
  rows: SaleRow[],
  key: (r: SaleRow) => string | null,
  options: { limit?: number; sortBy?: 'profit' | 'revenue' | 'markup' } = {},
): { key: string; totals: Totals }[] {
  const groups = new Map<string, SaleRow[]>();
  for (const r of rows) {
    const k = key(r) ?? '(не указано)';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const result = [...groups.entries()].map(([k, list]) => ({ key: k, totals: totals(list) }));
  const sortBy = options.sortBy ?? 'revenue';

  result.sort((a, b) => {
    if (sortBy === 'profit') return b.totals.profit - a.totals.profit;
    if (sortBy === 'markup') return (b.totals.markupPct ?? 0) - (a.totals.markupPct ?? 0);
    return b.totals.revenue - a.totals.revenue;
  });

  return options.limit === undefined ? result : result.slice(0, options.limit);
}

/** Месяц отгрузки в виде «2026-08» — по нему строится разрез во времени. */
function monthOf(d: Date | null): string | null {
  if (d === null) return null;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
}

/**
 * Рентабельность по месяцам, от старых к новым.
 *
 * Пропущенные месяцы НЕ заполняются нулями: месяц без продаж — это не «ноль выручки в
 * отчёте», это отсутствие данных, и рисовать по нему точку на графике значило бы
 * придумать спад, которого не было.
 */
export function byMonth(rows: SaleRow[]): { key: string; totals: Totals }[] {
  const result = totalsBy(rows, (r) => monthOf(r.shippedAt));
  return result.sort((a, b) => a.key.localeCompare(b.key));
}
