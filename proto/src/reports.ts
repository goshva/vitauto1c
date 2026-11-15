import { createRoute, z } from '@hono/zod-openapi';
import { pool } from './db.ts';
import { guard } from './auth.ts';
import { problemResponse } from './problem.ts';
import { createApi } from './api.ts';
import { byMonth, totals, totalsBy, type SaleRow } from './domain/reports.ts';

// Отчёты: маршруты (п. 8 плана волны 2).
//
// ПРАВА — ГЛАВНОЕ ЗДЕСЬ, И ОНИ НЕ ТАКИЕ, КАК В СПИСКЕ. В списке строк себестоимость можно
// просто не показывать: там есть другие колонки, и работа не останавливается. В отчёте
// прятать колонку БЕСПОЛЕЗНО — ИТОГ по ней всё равно покажет себестоимость, а вместе с
// ней и прибыль. Поэтому отчёт с себестоимостью не «показывается частично», а не
// открывается ролям, которым себестоимость закрыта.
//
// ЧТО НЕ ПОПАДАЕТ В ВЫРУЧКУ. Отменённые и возвращённые строки, а также неотгруженные.
// Отбор идёт В SQL, в одном месте: правило, продублированное в памяти, однажды разойдётся
// с базой, и отчёт покажет одно, а список — другое.

export const reports = createApi();

const TotalsSchema = z.object({
  lines: z.number().int(),
  units: z.number(),
  revenue: z.number(),
  cost: z.number(),
  profit: z.number(),
  markupPct: z.number().nullable().describe('Наценка в % от себестоимости; пусто — делить нельзя'),
  lossLines: z.number().int().describe('Строк продано ниже себестоимости'),
});

const PeriodQuery = z.object({
  dateFrom: z.string().optional().describe('С даты отгрузки, ГГГГ-ММ-ДД'),
  dateTo: z.string().optional().describe('По дату отгрузки включительно'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

/**
 * Строки для отчёта: только СОСТОЯВШИЕСЯ продажи.
 *
 * «Состоявшаяся» — это два условия сразу: состояние не отменено и есть ДАТА ОТГРУЗКИ.
 * Одно состояние без даты означало бы «закрыли, не отгрузив», и считать это выручкой
 * нельзя.
 */
async function loadSales(q: { dateFrom?: string; dateTo?: string }): Promise<SaleRow[]> {
  const params: unknown[] = [];
  // `not deleted` не нужен: представление отсекает удалённые само.
  const parts = [
    "status not in ('cancelled', 'refused', 'return')",
    '"shipmentDate" is not null',
  ];
  if (q.dateFrom) {
    params.push(q.dateFrom);
    parts.push(`"shipmentDate" >= $${params.length}::date`);
  }
  if (q.dateTo) {
    params.push(q.dateTo);
    parts.push(`"shipmentDate" < ($${params.length}::date + 1)`);
  }

  const r = await pool.query<{
    quantity: string; cost_price: string | null; sale_price: string | null;
    customer: string | null; nomenclature: string | null;
    shipment_date: Date | null; status: string;
  }>(
    // Имена колонок — КАК В ПРЕДСТАВЛЕНИИ (`camelCase`), а не как в таблице: `line_view`
    // переименовывает `cost_price` в `costPrice`. Отчёт, написанный по именам таблицы,
    // падал на `column "cost_price" does not exist` — ошибку нашли интеграционные тесты.
    `select quantity::text, "costPrice" as cost_price, "salePrice" as sale_price,
            customer, nomenclature, "shipmentDate" as shipment_date, status
       from line_view
      where ${parts.join(' and ')}`,
    params,
  );

  return r.rows.map((x) => ({
    quantity: Number(x.quantity),
    costPrice: x.cost_price === null ? null : Number(x.cost_price),
    salePrice: x.sale_price === null ? null : Number(x.sale_price),
    customer: x.customer,
    nomenclature: x.nomenclature,
    shippedAt: x.shipment_date,
    status: x.status,
  }));
}

// --- GET /reports/profitability — рентабельность продаж -------------------------------
reports.openapi(createRoute({
  method: 'get',
  path: '/reports/profitability',
  tags: ['reports'],
  summary: 'Рентабельность продаж: выручка, себестоимость, прибыль, наценка',
  request: {
    query: PeriodQuery.extend({
      groupBy: z.enum(['nomenclature', 'customer', 'month']).optional().default('nomenclature'),
    }),
  },
  responses: {
    200: { description: 'Итоги с разрезом', content: { 'application/json': { schema: z.object({
      totals: TotalsSchema,
      rows: z.array(z.object({ label: z.string(), totals: TotalsSchema })),
      byMonth: z.array(z.object({ label: z.string(), totals: TotalsSchema })),
      note: z.string().describe('Оговорки к цифрам: что не попало и почему'),
    }) } } },
    403: { description: 'Себестоимость закрыта для роли' },
  },
}), async (c) => {
  // Право проверяется ПЕРВЫМ: отчёт с себестоимостью не показывается частично.
  const denial = guard(c, 'report.cost');
  if (denial) return problemResponse(c, denial);

  const q = c.req.valid('query');
  const rows = await loadSales(q);

  const keyOf = q.groupBy === 'customer'
    ? (r: SaleRow): string | null => r.customer
    : (r: SaleRow): string | null => r.nomenclature;

  const groups = q.groupBy === 'month'
    ? byMonth(rows)
    : totalsBy(rows, keyOf, { limit: q.limit });

  // Оговорка обязательна: без неё цифру принимают за полную, хотя часть строк в неё
  // не вошла — и решение примут по неполным данным.
  const withoutCost = rows.filter((r) => r.costPrice === null).length;

  return c.json({
    totals: totals(rows),
    rows: groups.map((g) => ({ label: g.key, totals: g.totals })),
    byMonth: byMonth(rows).map((g) => ({ label: g.key, totals: g.totals })),
    note: `В расчёт вошли только состоявшиеся продажи: отгруженные и не отменённые.`
      + (withoutCost > 0
        ? ` Строк без себестоимости: ${withoutCost} — их выручка учтена, прибыль нет.`
        : ''),
  }, 200);
});

// --- GET /reports/stuck — зависшие строки ---------------------------------------------
reports.openapi(createRoute({
  method: 'get',
  path: '/reports/stuck',
  tags: ['reports'],
  summary: 'Строки, стоящие на месте дольше срока',
  request: { query: z.object({
    days: z.coerce.number().int().min(1).max(365).optional().default(3),
  }) },
  responses: {
    200: { description: 'Зависшие строки, старые первыми', content: { 'application/json': {
      schema: z.object({
        days: z.number().int(),
        total: z.number().int(),
        items: z.array(z.object({
          id: z.string(),
          order: z.number().int().nullable(),
          status: z.string(),
          customer: z.string().nullable(),
          nomenclature: z.string().nullable(),
          orderDate: z.string().nullable(),
          daysStuck: z.number().int(),
        })),
      }) } } },
  },
}), async (c) => {
  const noRight = guard(c, 'request.view');
  if (noRight) return problemResponse(c, noRight);

  const { days } = c.req.valid('query');

  // Зависшими не считаются закрытые и отменённые: они закончены, а не стоят.
  const r = await pool.query<{
    id: string; order: number | null; status: string; customer: string | null;
    nomenclature: string | null; order_date: Date | null; days_stuck: string;
  }>(
    // Тут имена ТОЖЕ как в представлении: `orderDate`, `order`. Ошибка «column "deleted"
    // does not exist» была из-за того же — я писал по именам таблицы.
    `select id, "order", status, customer, nomenclature, "orderDate" as order_date,
            (current_date - "orderDate"::date)::text as days_stuck
       from line_view
      where status not in ('closed', 'cancelled', 'refused')
        and "orderDate" is not null
        and "orderDate"::date < current_date - $1::int
      order by "orderDate", "order"`,
    [days],
  );

  return c.json({
    days,
    total: r.rowCount ?? 0,
    items: r.rows.map((x) => ({
      id: x.id,
      order: x.order,
      status: x.status,
      customer: x.customer,
      nomenclature: x.nomenclature,
      orderDate: x.order_date === null ? null : x.order_date.toISOString().slice(0, 10),
      daysStuck: Number(x.days_stuck),
    })),
  }, 200);
});
