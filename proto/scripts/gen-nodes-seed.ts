import { readFileSync, writeFileSync } from 'node:fs';

// СИД РУЧНОЙ ПРОВЕРКИ: по строке на КАЖДЫЙ УЗЕЛ каждого процесса.
//
// ЗАЧЕМ. Для сверки глазами нужен набор, где видно КАЖДЫЙ узел модели: 121 шаг в 11
// процессах. Витрина такой задачи не решает — там по строке на пару «процесс × состояние»
// (61), и по ней нельзя пройти все узлы.
//
// КАЖДАЯ СТРОКА ЗНАЕТ СВОЙ ПРОЦЕСС И ШАГ — без этого движение по процессу невозможно.
//
// КОММЕНТАРИЙ К СТРОКЕ НАЗЫВАЕТ УЗЕЛ И ПРОЦЕСС — «процесс 0 (Основной), шаг 5, узел P1».
// Это НЕ для работы, а для ручной проверки: в обычной работе комментарий пишет менеджер, и
// подменять его служебным текстом в промысле нельзя. Поэтому набор отдельный, отмечен
// префиксом `ПРОВ-`, и засевается своим ключом.
//
// СТРОКА НА КАЖДЫЙ УЗЕЛ, а не на каждый уникальный узел: один и тот же узел в разных
// процессах — разные шаги, и проверяющему нужно видеть оба.

interface Step {
  n: number;
  nodes: string[];
  titles: string[];
  roles: string[];
  note: string;
  status: string;
}

const m = JSON.parse(readFileSync('db/process-map.json', 'utf8')) as {
  // `scenarios` — МАССИВ процессов, а не объект с ключами. Первая версия объявляла его
  // объектом, и `Object.entries` по массиву давал индексы «0», «1», … вместо
  // идентификаторов: неверный тип не скрыл ошибку, а обосновал её.
  scenarios: { id: string; title?: string; steps: Step[] }[];
};

// СПИСОК ПРОЦЕССОВ, а не пар «индекс, процесс»: идентификатор берётся из самого процесса.
const scenarios = m.scenarios;
const allSteps = scenarios.reduce((s, x) => s + x.steps.length, 0);
const uniqueNodes = new Set(scenarios.flatMap((x) => x.steps.flatMap((st) => st.nodes)));

console.log(`процессов: ${scenarios.length}, шагов: ${allSteps}, уникальных узлов: ${uniqueNodes.size}`);

// Состояния, допустимые для строки: берём из карты. Значения вида «M15,K7» — это список
// узлов, а состояние всегда одно.
const STATUSES = new Set(scenarios.flatMap((x) => x.steps.map((st) => st.status)));

const hex = (prefix: string, n: number): string =>
  prefix + '000000-0000-0000-0000-' + String(n).padStart(12, '0');

const orders: string[] = [];
const lines: string[] = [];
const facts: string[] = [];

let seq = 0;
let carried = 0;

for (const proc of scenarios) {
  // `scenarios` — МАССИВ: `Object.entries` дал бы индексы «0», «1», а не идентификаторы.
  const processId = proc.id;
  // СОСТОЯНИЕ ПЕРЕНОСИТСЯ С ПРЕДЫДУЩЕГО ШАГА. Шаг без своего состояния состояние НЕ
  // МЕНЯЕТ: строка проходит через него с тем, что было. Подставить сюда «new» значило бы
  // показать проверяющему несуществующее состояние.
  let lastStatus: string | null = null;

  for (const st of proc.steps) {
    const status: string = st.status ?? lastStatus ?? 'new';
    if (st.status === null || st.status === undefined) carried++;
    lastStatus = status;

    seq++;
    // По строке на узел шага: у шага их бывает несколько (M15 и K7 — два узла сразу).
    for (let k = 0; k < st.nodes.length; k++) {
      const node = st.nodes[k]!;
      const orderId = hex('a1', 5000 + seq);
      const lineId = hex(b2_1(k), 5000 + seq);

      const comment = `процесс ${processId} (${proc.title ?? 'без названия'}), `
        + `шаг ${st.n}, узел ${node}`;

      if (k === 0) {
        orders.push(
          `insert into customer_order (id, number, date, operation, counterparty_id,`
          + ` contract_id, organization_id, total, status)`
          + ` values ('${orderId}', 'ПРОВ-${processId}-${st.n}', current_date, 'sale',`
          + ` '66666666-6666-6666-6666-666666666601',`
          + ` 'ee000000-0000-0000-0000-000000000003',`
          + ` '55555555-5555-5555-5555-555555555501', 0, 'new')`
          + ` on conflict (id) do nothing;`,
        );
      }

      lines.push(
        `insert into line (id, customer_order_id, operation, status, quantity,`
        + ` nomenclature_id, customer_id, contract_id, order_date, comment,`
        + ` internal_order_number, process_id, process_step)`
        + ` values ('${lineId}', '${orderId}', 'sale', '${status}', 1,`
        + ` '77777777-7777-7777-7777-777777777702',`
        + ` '66666666-6666-6666-6666-666666666601',`
        + ` 'ee000000-0000-0000-0000-000000000003', current_date,`
        + ` '${comment.replace(/'/g, "''")}', 'ПРОВ-${processId}-${st.n}',`
        + ` '${processId}', ${st.n})`
        + ` on conflict (id) do update set status = excluded.status, comment = excluded.comment,`
        + ` process_id = excluded.process_id, process_step = excluded.process_step;`,
      );

      facts.push(
        `insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article,`
        + ` fact_unit, vehicle_plate)`
        + ` values ('${lineId}', 'ПРОВ-${processId}-${st.n}', '${st.titles[0] ?? 'шаг'}', '1',`
        + ` '${node}', 'шт', 'А000ПР77') on conflict (id) do nothing;`,
      );
    }
  }
}

/** Префикс идентификатора: `b2` для первого узла шага, `b3` для второго. */
function b2_1(k: number): string {
  return k === 0 ? 'b2' : 'b3';
}

const header = `-- СИД РУЧНОЙ ПРОВЕРКИ: строка на каждый узел каждого процесса.
-- Сгенерировано scripts/gen-nodes-seed.ts — не править руками.
--
-- ПРОЦЕССОВ: ${scenarios.length}
-- ШАГОВ:     ${allSteps}
-- УЗЛОВ:     ${uniqueNodes.size} уникальных, строк ${lines.length}
--
-- КОММЕНТАРИЙ К СТРОКЕ называет узел и процесс: «процесс 0 (Основной), шаг 5, узел P1».
-- Это ДЛЯ РУЧНОЙ ПРОВЕРКИ, а не для работы: в промысле комментарий пишет менеджер.
-- Поэтому набор отдельный, с префиксом ПРОВ-.
--
-- ЗАПУСК: bun run db:seed --nodes

delete from line_mark where id in (select id from line where internal_order_number like 'ПРОВ-%');
delete from line_fact where id in (select id from line where internal_order_number like 'ПРОВ-%');
delete from line where internal_order_number like 'ПРОВ-%';
delete from customer_order where number like 'ПРОВ-%';

`;

writeFileSync('db/seed/nodes.sql', header
  + orders.join('\n') + '\n\n'
  + lines.join('\n') + '\n\n'
  + facts.join('\n') + '\n', 'utf8');

console.log(`  записано: db/seed/nodes.sql`);
console.log(`  заказов: ${orders.length}, строк: ${lines.length}`);
console.log(`  состояний задействовано: ${[...STATUSES].length}`);
console.log(`  пример комментария: процесс 0 (Основной: закупка → отгрузка), шаг 5, узел P1`);
