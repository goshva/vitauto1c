import { pool } from './db.ts';
import type { SaleRow } from './domain/reports.ts';

// Выборка данных для отчётов: одна на API и экран.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ МОДУЛЕМ. Экран и API показывают ОДНИ И ТЕ ЖЕ цифры, и это не
// пожелание, а требование: разойдись они — оператор увидит одно, а выгрузка отдаст
// другое, и веры не будет ни одной из них. Условия отбора живут здесь в одном месте.
//
// ФАЙЛ ВЫНЕСЕН из `reports.ts` ещё и по размеру: тот упёрся в предел 200 строк из §12, а
// выборка — самостоятельная часть со своей причиной меняться.

/** Период отбора. Пусто — без ограничения. */
export interface Period {
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Строки отчёта о ПРОДАЖАХ: только состоявшиеся продажи.
 *
 * «Состоявшаяся» — ДВА условия сразу: состояние не отменено и есть ДАТА ОТГРУЗКИ. Одно
 * состояние без даты означало бы «закрыли, не отгрузив», и считать это выручкой нельзя.
 *
 * РЕМОНТА ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ ЗАКАЗЧИКА (20.11.2026): у наряда своя дата признания
 * и своё правило счёта (работы — по нормо-часам), поэтому он считается отдельным
 * отчётом `loadRepair`. Смешав их, нельзя было бы ответить «сколько дала торговля»
 * отдельно от «сколько дал ремонт».
 *
 * ИМЕНА КОЛОНОК — КАК В ПРЕДСТАВЛЕНИИ, а не как в таблице: `line_view` переименовывает
 * `cost_price` в `costPrice`. Отчёт, написанный по именам таблицы, падал на
 * `column "cost_price" does not exist` — ошибку нашли интеграционные тесты, и лишь они:
 * в модульных расчёт отделён от выборки.
 */
export async function loadSales(q: Period = {}): Promise<SaleRow[]> {
  const params: unknown[] = [];
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
    `select quantity::text, "costPrice"::text as cost_price, "salePrice"::text as sale_price,
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
    kind: 'sale' as const,
    hours: null,
  }));
}

/**
 * Строки отчёта о РЕМОНТЕ: работы и запчасти ЗАКРЫТЫХ заказ-нарядов.
 *
 * Датой признания служит `work_order.closed_at`: наряд не отгружается, он выполняется.
 * Работа отличается от запчасти наличием нормо-часов, и в отчёте она считается
 * `часы × цена` — поэтому у строки есть `kind` и `hours` (`src/domain/reports.ts`).
 */
export async function loadRepair(q: Period = {}): Promise<SaleRow[]> {
  const params: unknown[] = [];
  const parts = [
    "w.status = 'closed'",
    'w.deleted_at is null',
    'not l.deleted',
    // Строку с отгрузкой считает отчёт о продажах: иначе один и тот же товар попал бы
    // в два отчёта — и как отгруженный, и как выполненный в наряде.
    'l.shipment_doc_id is null',
  ];
  if (q.dateFrom) {
    params.push(q.dateFrom);
    parts.push(`w.closed_at >= $${params.length}::date`);
  }
  if (q.dateTo) {
    params.push(q.dateTo);
    parts.push(`w.closed_at < ($${params.length}::date + 1)`);
  }

  const r = await pool.query<{
    quantity: string; cost_price: string | null; sale_price: string | null;
    customer: string | null; nomenclature: string | null;
    closed_at: Date | null; status: string; kind: string; hours: string | null;
  }>(
    `select l.quantity::text, l.cost_price::text, l.sale_price::text,
            cust.name as customer,
            -- У работы номенклатуры нет: её название лежит в факте строки, и без
            -- подстановки разрез по номенклатуре показал бы «(не указано)».
            coalesce(n.name, f.fact_name) as nomenclature,
            w.closed_at, l.status,
            case when l.norm_hours is null then 'repair-part' else 'repair-labor' end as kind,
            l.norm_hours::text as hours
       from line l
       join work_order w on w.id = l.work_order_id
       left join nomenclature n on n.id = l.nomenclature_id
       left join line_fact f on f.id = l.id
       left join counterparty cust on cust.id = l.customer_id
      where ${parts.join(' and ')}`,
    params,
  );

  return r.rows.map((x) => ({
    quantity: Number(x.quantity),
    costPrice: x.cost_price === null ? null : Number(x.cost_price),
    salePrice: x.sale_price === null ? null : Number(x.sale_price),
    customer: x.customer,
    nomenclature: x.nomenclature,
    shippedAt: x.closed_at,
    status: x.status,
    kind: x.kind as SaleRow['kind'],
    hours: x.hours === null ? null : Number(x.hours),
  }));
}

/** Зависшая строка: стоит на месте дольше срока. */
export interface StuckRow {
  id: string;
  order: number | null;
  status: string;
  customer: string | null;
  nomenclature: string | null;
  orderDate: string | null;
  daysStuck: number;
}

/**
 * Строки, стоящие на месте дольше срока.
 *
 * ЗАКРЫТЫЕ И ОТМЕНЁННЫЕ СЮДА НЕ ПОПАДАЮТ: они закончены, а не стоят. Без этого условия
 * отчёт «зависшие» показывал бы весь архив, и на него перестали бы смотреть.
 */
export async function loadStuck(days: number): Promise<StuckRow[]> {
  const r = await pool.query<{
    id: string; order: number | null; status: string; customer: string | null;
    nomenclature: string | null; order_date: Date | null; days_stuck: string;
  }>(
    `select id, "order", status, customer, nomenclature, "orderDate" as order_date,
            (current_date - "orderDate"::date)::text as days_stuck
       from line_view
      where status not in ('closed', 'cancelled', 'refused')
        and "orderDate" is not null
        and "orderDate"::date < current_date - $1::int
      order by "orderDate", "order"`,
    [days],
  );

  return r.rows.map((x) => ({
    id: x.id,
    order: x.order,
    status: x.status,
    customer: x.customer,
    nomenclature: x.nomenclature,
    orderDate: x.order_date === null ? null : x.order_date.toISOString().slice(0, 10),
    daysStuck: Number(x.days_stuck),
  }));
}
