import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Генератор сидов процессов. Пишет `db/seed/processes/<id>.sql` — по файлу на процесс,
// как требует задание §2.3. Генератор, а не девять рукописных файлов: у них общий
// каркас, и расхождение в нём (забыл снять отметку, забыл создать заказ) давало бы
// разные начальные условия у похожих процессов.
//
// Начальное состояние выведено из СМЫСЛА процесса, а не выдумано:
//   N1 «Заявка»            → new
//   K3 «Комплектация»      → assembly   (сборочный лист уже печатают)
//   M10 после отгрузки     → ordered    (заказ у поставщика размещён)
//   N3 «Возврат товара»    → shipped    (вернуть можно только отгруженное)
//   M16 «Возврат поставщику» → return
//   N2a «Получение товара» → ready_to_ship (клиент отказался при получении)

interface ProcessSeed {
  id: string;
  index: number;
  title: string;
  /** Статус строки при старте. */
  status: string;
  /** Сколько строк в заказе. */
  lines: number;
  /** Остаток на складе для первой строки (0 — нет остатка). */
  stock: number;
  /** Наименование «как написал клиент» — у каждого процесса своё, иначе строки не различить. */
  factName: string;
  article: string;
  /** Номенклатура, если товар есть на складе. */
  nomenclatureId?: string;
  /** Нужен ли автомобиль (ремонт). */
  car?: boolean;
  /** Пометка о смысле начального состояния. */
  note: string;
}

const PROCESSES: ProcessSeed[] = [
  { id: 'happy', index: 1, title: 'Основной: закупка → отгрузка', status: 'new', lines: 1, stock: 0,
    factName: 'Фильтр масляный', article: 'FLT-OIL-001',
    note: 'остатка нет намеренно — путь идёт через закупку у поставщика (M4)' },
  { id: 'stock', index: 2, title: 'Со склада (резерв)', status: 'new', lines: 1, stock: 10,
    factName: 'Фильтр салонный', article: 'FLT-CAB-001',
    nomenclatureId: '77777777-7777-7777-7777-777777777707',
    note: 'товар уже есть, поэтому путь идёт через резерв (M3), а не через закупку' },
  { id: 'mixed_order', index: 3, title: 'Смешанный заказ (склад + закупка)', status: 'new', lines: 2, stock: 10,
    factName: 'Колодки тормозные передние', article: 'BRK-FR-001',
    nomenclatureId: '77777777-7777-7777-7777-777777777703',
    note: 'две строки: первая закрывается со склада (M3), вторая уходит в закупку (M4)' },
  { id: 'delivery_split', index: 4, title: 'Самовывоз у внешнего поставщика клиентом', status: 'new', lines: 1, stock: 0,
    factName: 'Антифриз G12+ (5л)', article: 'ANT-G12-5L',
    note: 'остатка нет; товар забирает клиент, поэтому ячейка склада не участвует' },
  { id: 'virtual_buy', index: 5, title: 'Виртуальный закуп (менеджер → админ)', status: 'new', lines: 1, stock: 0,
    factName: 'Свеча зажигания', article: 'SPK-IR-001',
    note: 'короткий процесс: заявка сразу уходит в закупку без комплектации' },
  { id: 'defect', index: 6, title: 'Контроль комплектации → снова задание', status: 'assembly', lines: 1, stock: 5,
    factName: 'Фильтр воздушный', article: 'FLT-AIR-001',
    nomenclatureId: '77777777-7777-7777-7777-777777777706',
    note: 'строка уже комплектуется (K3): процесс начинается с контроля, а не с заявки' },
  { id: 'cancel_supplier', index: 7, title: 'Отмена заказа у поставщика', status: 'ordered', lines: 1, stock: 0,
    factName: 'Масло моторное 5W-30 (5л)', article: 'MOT5W30-5L',
    note: 'заказ поставщику размещён — его и отменяют' },
  { id: 'return', index: 8, title: 'Возврат от клиента', status: 'shipped', lines: 1, stock: 0,
    factName: 'Фильтр масляный', article: 'FLT-OIL-001',
    note: 'вернуть можно только отгруженное (N3), поэтому старт — shipped' },
  { id: 'return_mgr', index: 9, title: 'Возврат поставщику (от менеджера)', status: 'return', lines: 1, stock: 3,
    factName: 'Фильтр салонный', article: 'FLT-CAB-001',
    nomenclatureId: '77777777-7777-7777-7777-777777777707',
    note: 'возврат уже оформлен (M16): оформляют заявку поставщику' },
  { id: 'return_internal', index: 10, title: 'Отказ клиента при получении товара', status: 'ready_to_ship', lines: 1, stock: 3,
    factName: 'Колодки тормозные передние', article: 'BRK-FR-001',
    nomenclatureId: '77777777-7777-7777-7777-777777777703',
    note: 'товар собран и ждёт клиента (N2a), клиент отказывается при получении' },
  { id: 'car_repair_in', index: 11, title: 'Поступление машины в ремонт', status: 'new', lines: 1, stock: 0,
    factName: 'Замена масла (работа)', article: 'SRV-OIL-001',
    car: true,
    note: 'вход в ремонт (G1): к заказу привязан автомобиль, заказ-наряд открывается первым шагом' },
];

const hex = (n: number): string => n.toString(16).padStart(2, '0');

/** Идентификаторы фиксированы: тест ссылается на строку, а не ищет «что-нибудь». */
const orderId = (i: number) => `a0000000-0000-0000-0000-00000000f0${hex(i)}`;

/**
 * Идентификаторы строк.
 *
 * Последняя группа UUID обязана быть ровно 12 шестнадцатеричных цифр.
 * Однострочный процесс: 10 нулей + 2 цифры индекса. Многорядный: 8 нулей +
 * 2 цифры индекса + 2 цифры номера строки. Первая версия клеила суффикс к 12 цифрам
 * и давала 14 — Postgres отвечал «invalid input syntax for type uuid» (проверено).
 */
function lineIds(p: ProcessSeed): string[] {
  const idx = hex(p.index);
  if (p.lines === 1) return [`b0000000-0000-0000-0000-0000000000${idx}`];
  return [
    `b0000000-0000-0000-0000-00000000${idx}01`,
    `b0000000-0000-0000-0000-00000000${idx}02`,
  ];
}

/** Идентификаторы движений склада: та же схема, что у строк. */
function moveIds(p: ProcessSeed): string[] {
  const idx = hex(p.index);
  if (p.lines === 1) return [`c0000000-0000-0000-0000-0000000000${idx}`];
  return [
    `c0000000-0000-0000-0000-00000000${idx}01`,
    `c0000000-0000-0000-0000-00000000${idx}02`,
  ];
}

function sql(p: ProcessSeed): string {
  const ids = lineIds(p);
  const moves = moveIds(p);
  const oid = orderId(p.index);
  const del = ids
    .map((id) => `delete from line_mark where id = '${id}';\ndelete from line_fact where id = '${id}';\ndelete from stock_move where line_id = '${id}';\ndelete from line where id = '${id}';`)
    .join('\n');

  const inserts = ids
    .map((id, i) => {
      const stockQty = i === 0 ? p.stock : 0;
      // Колонки места хранения добавляются ТОЛЬКО вместе со значениями: иначе
      // Postgres отвечает «INSERT has more target columns than expressions»
      // (проверено на процессах без остатка).
      const withPlace = stockQty > 0;
      const extra = withPlace ? `,\n                  warehouse_id, cell_id` : '';
      const extraVal = withPlace
        ? `,\n        '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888802'`
        : '';
      const stock = stockQty > 0
        ? `\ninsert into stock_move (id, nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)\nvalues ('${moves[i]}',\n        '${p.nomenclatureId}',\n        '44444444-4444-4444-4444-444444444401',\n        '88888888-8888-8888-8888-888888888802',\n        'receipt', ${stockQty},\n        '${id}',\n        'Начальный остаток сида ${p.id}');\n`
        : '';
      return `insert into line (id, customer_order_id, operation, status, quantity,
                  nomenclature_id, customer_id, contract_id, order_date,
                  internal_order_number${extra})
values ('${id}',
        '${oid}', 'sale', '${p.status}', ${i + 1},
        ${stockQty > 0 ? `'${p.nomenclatureId}'` : 'null'},
        '${CUSTOMER}', '${CONTRACT}',
        '2026-11-13',
        'ВТ-${p.id.toUpperCase()}-${i + 1}'${extraVal});

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('${id}', 'ЗК-${p.id.toUpperCase()}-${i + 1}',
        '${p.factName}', '${i + 1}', '${p.article}', 'шт', 'А123ВС777');

insert into line_mark (id, marked, marked_by_id)
values ('${id}', false, null)
on conflict (id) do update set marked = false, marked_by_id = null;
${stock}`;
    })
    .join('\n');

  const carNote = p.car
    ? `\n-- Автомобиль: процесс начинается с открытия заказ-наряда (G1).\ninsert into work_order (number, date, car_id, counterparty_id, organization_id, service_type_id, total)\nvalues ('ЗН-${p.id.toUpperCase()}', '2026-11-13',\n        '${CAR}', '${CUSTOMER}', '${ORG}', '${SERVICE_KIND}', 0)\non conflict do nothing;\n`
    : '';

  return `-- Процесс ${p.id}: ${p.title}
-- Начальное состояние: статус «${p.status}», строк ${p.lines}, остаток ${p.stock}.
-- ${p.note}
--
-- Фиксированные UUID: тест ссылается на конкретную строку, а не ищет «что-нибудь».
-- Файл сгенерирован scripts/gen-process-seeds.ts — правки вносятся в таблицу процессов.

${del}
delete from customer_order where id = '${oid}';

insert into customer_order (id, number, date, operation, client_order_number,
                            counterparty_id, contract_id, organization_id, ship_date, total)
values ('${oid}', 'TEST-${p.id.toUpperCase()}-001', '2026-11-13', 'sale', 'ЗК-${p.id.toUpperCase()}-1',
        '${CUSTOMER}',
        '${CONTRACT}',
        '${ORG}',
        '2026-11-20', ${p.lines * 1200});

${inserts}${carNote}`;
}

const CUSTOMER = '66666666-6666-6666-6666-666666666601';
const CONTRACT = 'ee000000-0000-0000-0000-000000000003';
const ORG = '55555555-5555-5555-5555-555555555501';
const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const SERVICE_KIND = '22222222-2222-2222-2222-222222222201';

// Генератор лежит в scripts/, а сиды — в db/seed/processes/. Без этой поправки
// файлы писались в scripts/processes/ и падало с ENOENT при чтении.
const dir = resolve(import.meta.dir, '../db/seed/processes');
for (const p of PROCESSES) {
  writeFileSync(resolve(dir, `${p.id}.sql`), sql(p), 'utf8');
}
console.log(`сиды процессов записаны: ${PROCESSES.length} файлов`);
console.log(PROCESSES.map((p) => `${p.id}(${p.status})`).join(', '));
