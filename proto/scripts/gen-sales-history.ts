import { writeFileSync } from 'node:fs';

// ГЕНЕРАТОР ИСТОРИИ ПРОДАЖ для витрины — 20 ч отчётности, первые по плану.
//
// ЗАЧЕМ. Модель для отчётов готова (`line_view` отдаёт цену, себестоимость, суммы,
// даты), но показывать нечего: в базе НОЛЬ строк с себестоимостью и НОЛЬ отгруженных.
// Отчёт на пустой базе проверить не на чем — он либо пустая таблица, либо, что хуже,
// правдоподобные нули.
//
// ЧТО ГЕНЕРИРУЕТСЯ: проданные строки за полгода — с себестоимостью, ценой продажи,
// датами отгрузки, разными заказчиками и наценками. Плюс строки с особыми случаями:
// возврат, отмена, нулевая наценка и продажа ниже себестоимости.
//
// ЧИСЛА ДЕТЕРМИНИРОВАНЫ. Никакого `Math.random()`: отчёты проверяются СРАВНЕНИЕМ с
// заранее посчитанным ответом, и при случайных данных такой тест невозможен в принципе.
// Здесь линейный конгруэнтный генератор с фиксированным зерном — последовательность
// одна и та же при каждом запуске.
//
// ЗАПУСК: bun run scripts/gen-sales-history.ts
// РЕЗУЛЬТАТ: db/seed/sales-history.sql

const OUT = 'db/seed/sales-history.sql';

/** Линейный конгруэнтный генератор: последовательность воспроизводима. */
function lcg(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const rand = lcg(20261115);

// Справочники: идентификаторы настоящие, из refs.sql.
const CUSTOMERS = [
  { id: '66666666-6666-6666-6666-666666666601', contract: 'ee000000-0000-0000-0000-000000000003', name: 'ИП Иванов' },
  { id: '66666666-6666-6666-6666-666666666602', contract: 'ee000000-0000-0000-0000-000000000003', name: 'АвтоЛюкс' },
  { id: '66666666-6666-6666-6666-666666666603', contract: 'ee000000-0000-0000-0000-000000000003', name: 'АвтоДеталь Сервис' },
];

const NOMENCLATURE = [
  { id: '77777777-7777-7777-7777-777777777701', name: 'Масло моторное 5W-30 (5л)', cost: 900 },
  { id: '77777777-7777-7777-7777-777777777702', name: 'Фильтр масляный', cost: 480 },
  { id: '77777777-7777-7777-7777-777777777703', name: 'Колодки тормозные передние', cost: 1800 },
  { id: '77777777-7777-7777-7777-777777777704', name: 'Антифриз G12+ (5л)', cost: 1100 },
  { id: '77777777-7777-7777-7777-777777777705', name: 'Свеча зажигания', cost: 700 },
  { id: '77777777-7777-7777-7777-777777777706', name: 'Фильтр воздушный', cost: 900 },
  { id: '77777777-7777-7777-7777-777777777707', name: 'Фильтр салонный', cost: 750 },
  { id: '77777777-7777-7777-7777-777777777709', name: 'Фильтр масляный (аналог)', cost: 395 },
];

// Наценки: разные, чтобы в отчёте рентабельности было что сравнивать. 1.0 — продажа
// по себестоимости, 0.9 — НИЖЕ себестоимости: это настоящий случай, и отчёт обязан
// показать убыток, а не спрятать его.
const MARKUPS = [1.15, 1.3, 1.45, 1.6, 1.8, 2.0, 1.0, 0.9];

/**
 * Идентификатор в формате UUID.
 *
 * ПЕРВАЯ ВЕРСИЯ ЭТОГО НЕ ДЕЛАЛА: склеивала префикс с 35 цифрами и давала 37 символов.
 * Postgres отказал на засеве — `invalid input syntax for type uuid`. Формат собираем
 * явно: 8-4-4-4-12, иначе ошибка вылезает не при сборке, а при загрузке.
 */
const hex = (prefix: string, n: number): string =>
  prefix + '000000-0000-0000-0000-' + String(n).padStart(12, '0');

// НАКОПЛЕНИЕ В ТОМ ЖЕ ПРОХОДЕ, что и строки: ожидание и записанные значения
// обязаны быть одними и теми же числами, а не двумя реализациями одного расчёта.
const lines: string[] = [];
const orders: string[] = [];
const shipments: string[] = [];
let soldCount = 0;
let revenue = 0;
let costSum = 0;
let profitCount = 0;

const HORIZON_DAYS = 180;
const COUNT = 60;

for (let i = 0; i < COUNT; i++) {
  const orderId = hex('a1', 1000 + i);
  const lineId = hex('b2', 1000 + i);
  const shipmentId = hex('c3', 1000 + i);

  const customer = CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)]!;
  const nom = NOMENCLATURE[Math.floor(rand() * NOMENCLATURE.length)]!;
  const markup = MARKUPS[Math.floor(rand() * MARKUPS.length)]!;
  const qty = 1 + Math.floor(rand() * 4);

  // День внутри полугодия: дата считается от СЕГОДНЯ назад, поэтому витрина не
  // устаревает — отчёт всегда охватывает последние месяцы.
  const daysAgo = Math.floor(rand() * HORIZON_DAYS);
  const cost = nom.cost * qty;
  const price = Math.round(nom.cost * markup * qty * 100) / 100;

  // Особые случаи — их немного, и каждый нужен отчёту отдельно:
  //   каждая 13-я строка — возврат клиента (не должна попасть в выручку);
  //   каждая 17-я — отмена (не продажа вовсе);
  //   остальные — состоявшиеся продажи.
  const isReturn = i % 13 === 12;
  const isCancelled = i % 17 === 16;
  const status = isCancelled ? 'cancelled' : isReturn ? 'return' : 'closed';

  // Считаем ТОЛЬКО состоявшиеся продажи: возврат и отмена в выручку не входят.
  if (!isCancelled && !isReturn) {
    soldCount++;
    revenue += price;
    costSum += cost;
    if (markup > 1) profitCount++;
  }

  orders.push(
    `insert into customer_order (id, number, date, operation, client_order_number,`
    + ` counterparty_id, contract_id, organization_id, ship_date, total, status)`
    + ` values ('${orderId}', 'ИП-${1000 + i}', current_date - ${daysAgo}, 'sale',`
    + ` 'ИП-${1000 + i}', '${customer.id}', '${customer.contract}',`
    + ` '55555555-5555-5555-5555-555555555501', current_date - ${daysAgo} + 3,`
    + ` ${price}, 'new') on conflict (id) do nothing;`,
  );

  shipments.push(
    `insert into shipment (id, number, date, status, operation, counterparty_id,`
    + ` customer_order_id, warehouse_id)`
    + ` values ('${shipmentId}', 'ИП-ОТ-${1000 + i}', current_date - ${daysAgo},`
    + ` 'shipped', 'sale', '${customer.id}', '${orderId}',`
    + ` '44444444-4444-4444-4444-444444444401') on conflict (id) do nothing;`,
  );

  lines.push(
    `insert into line (id, customer_order_id, operation, status, quantity,`
    + ` nomenclature_id, customer_id, contract_id, order_date, cost_price, sale_price,`
    + ` shipment_doc_id, warehouse_id, internal_order_number)`
    + ` values ('${lineId}', '${orderId}', 'sale', '${status}', ${qty},`
    + ` '${nom.id}', '${customer.id}', '${customer.contract}',`
    + ` current_date - ${daysAgo}, ${nom.cost}, ${Math.round(price / qty * 100) / 100},`
    + ` '${shipmentId}', '44444444-4444-4444-4444-444444444401',`
    + ` 'ИП-${1000 + i}') on conflict (id) do nothing;`,
  );

  lines.push(
    `insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article,`
    + ` fact_unit, vehicle_plate)`
    + ` values ('${lineId}', 'ИП-${1000 + i}', '${nom.name}', '${qty}',`
    + ` 'ART-${1000 + i}', 'шт', 'А${100 + i}ВС77')`
    + ` on conflict (id) do nothing;`,
  );
}

const header = `-- ИСТОРИЯ ПРОДАЖ для витрины. Сгенерировано scripts/gen-sales-history.ts.
--
-- ЗАЧЕМ: модель для отчётов готова, но в базе НОЛЬ строк с себестоимостью и НОЛЬ
-- отгруженных. Отчёт на пустой базе проверить не на чем.
--
-- ЧИСЛА ДЕТЕРМИНИРОВАНЫ: линейный конгенератор с фиксированным зерном. Отчёты
-- проверяются сравнением с посчитанным ответом, а при случайных данных такой тест
-- невозможен.
--
-- ОЖИДАЕМЫЕ ИТОГИ (сгенерировано вместе со строками):
--   продано строк:      ${soldCount} из ${COUNT}
--   выручка:            ${revenue.toFixed(2)}
--   себестоимость:      ${costSum.toFixed(2)}
--   прибыль:            ${(revenue - costSum).toFixed(2)}
--   прибыльных строк:   ${profitCount}
--   возвратов:          ${Math.floor(COUNT / 13)}
--   отмен:              ${Math.ceil(COUNT / 17)}
--
-- ЗАПУСК: bun run db:seed --sales

delete from line_mark where id in (select id from line where internal_order_number like 'ИП-%');
delete from line_fact where id in (select id from line where internal_order_number like 'ИП-%');
delete from line where internal_order_number like 'ИП-%';
delete from shipment where number like 'ИП-%';
delete from customer_order where number like 'ИП-%';

`;

writeFileSync(OUT, header
  + orders.join('\n') + '\n\n'
  + shipments.join('\n') + '\n\n'
  + lines.join('\n') + '\n', 'utf8');

console.log(`история продаж записана: ${OUT}`);
console.log(`  заказов: ${orders.length}, отгрузок: ${shipments.length}`);
console.log(`  продано строк: ${soldCount} из ${COUNT}`);
console.log(`  выручка: ${revenue.toFixed(2)}, себестоимость: ${costSum.toFixed(2)}`);
console.log(`  прибыль: ${(revenue - costSum).toFixed(2)}, прибыльных строк: ${profitCount}`);
