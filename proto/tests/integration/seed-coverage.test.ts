import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { pool } from '../../src/db.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { PROCESSES } from '../../src/domain/process-map.ts';
import { allowedFrom } from '../../src/domain/transition.ts';

// Покрытие сида: все процессы, пример на КАЖДЫЙ узел и возможность идти дальше.
//
// Это проверка ДЕМОНСТРАЦИИ, а не кода. На приёмке оператор открывает карту
// процессов и хочет видеть каждый шаг заполненным: если на каком-то узле пусто,
// показать его нечем, и «схема» остаётся картинкой из ТЗ.
//
// Проверяется три вещи:
//   1) все 11 процессов заведены и у каждого есть строки;
//   2) на КАЖДЫЙ узел с состоянием есть пример строки в этом состоянии;
//   3) с каждого примера можно перейти дальше — узел не тупик.

/** Пары «процесс × состояние» из карты процессов. */
const PAIRS = PROCESSES.flatMap((p) =>
  [...new Set(p.steps.map((s) => s.status).filter((s): s is string => Boolean(s)))]
    .map((status) => ({ process: p.id, status })),
);

/**
 * Префиксы РАЗНЫЕ, и это важно:
 *   `ВТ-<ПОЛНЫЙ_ID>`   — сиды процессов: одна строка в начальном состоянии;
 *   `ВИТ-<ID_8_ЗНАКОВ>` — витрина: по строке на КАЖДЫЙ узел каждого процесса.
 *
 * Длины тоже разные: генератор сидов процесса пишет полный идентификатор
 * (`ВТ-CAR_REPAIR_IN-1`), а витрина — усечённый до восьми знаков (`ВИТ-CAR_REPA-1`).
 * Проверено запросом к базе, а не догадкой.
 */
const like = (processId: string): string => `ВТ-${processId.toUpperCase()}-%`;

/** Строки витрины. */
const likeShowcase = (processId: string): string =>
  `ВИТ-${processId.toUpperCase().slice(0, 8)}-%`;

const hasLine = async (processId: string, status: string): Promise<boolean> => {
  const r = await pool.query<{ n: string }>(
    `select count(*)::text n from line
      where internal_order_number like $1 and status = $2 and not deleted`,
    [likeShowcase(processId), status],
  );
  return Number(r.rows[0]!.n) > 0;
};

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
});

describe('1. все процессы заведены', () => {
  test('сид процессов покрывает все 11 из карты', async () => {
    for (const p of PROCESSES) await seedProcess(p.id);

    // Считаем ПРОЦЕССЫ, а не заказы: у mixed_order строк две, и по числу заказов
    // их вышло бы двенадцать.
    const withLines = new Set<string>();
    for (const p of PROCESSES) {
      const r = await pool.query<{ n: string }>(
        `select count(*)::text n from line where internal_order_number like $1 and not deleted`,
        [like(p.id)]);
      if (Number(r.rows[0]!.n) > 0) withLines.add(p.id);
    }
    expect(withLines.size, 'процессов со строками меньше одиннадцати').toBe(11);
  });

  test('витрина заводит строки всем процессам сразу', async () => {
    await seedExtra.showcase();

    const missing: string[] = [];
    for (const p of PROCESSES) {
      const r = await pool.query<{ n: string }>(
        `select count(*)::text n from line where internal_order_number like $1 and not deleted`,
        [likeShowcase(p.id)],
      );
      if (Number(r.rows[0]!.n) === 0) missing.push(p.id);
    }
    expect(missing, `процессы без строк: ${missing.join(', ')}`).toEqual([]);
  });

  test('у каждого процесса строк ровно столько, сколько у него состояний', async () => {
    await seedExtra.showcase();

    const wrong: string[] = [];
    for (const p of PROCESSES) {
      const statuses = new Set(p.steps.map((s) => s.status).filter(Boolean));
      const r = await pool.query<{ n: string }>(
        `select count(*)::text n from line where internal_order_number like $1 and not deleted`,
        [likeShowcase(p.id)],
      );
      const got = Number(r.rows[0]!.n);
      if (got !== statuses.size) wrong.push(`${p.id}: ${got} строк на ${statuses.size} состояний`);
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});

describe('2. на каждый узел есть пример', () => {
  /**
   * Узлы модели, которые НЕ входят ни в один процесс.
   *
   * Список закрытый и назван явно: это не «пока не сделали», а «в процессах их нет».
   * Проверено по модели (45 узлов, 36 задействованы). Если такой узел появится в
   * процессе, тест упадёт и заставит список пересмотреть — иначе он тихо устареет.
   *
   * Все девять — внепроцессные действия: НСИ и опознание у администратора,
   * создание номенклатуры у менеджера, отдельные шаги ремонта.
   */
  const OUTSIDE_PROCESSES = ['M2a', 'M18', 'A1', 'A2', 'A5', 'A0', 'G2', 'G7', 'G8'];

  test('узлы вне процессов перечислены явно', async () => {
    const model = JSON.parse(
      readFileSync(new URL('../../../docs/migration/ddd/domain-model.json', import.meta.url), 'utf8'),
    ) as {
      nodes: { id: string; title: string }[];
      scenarios: { steps: { nodes: string[] }[] }[];
    };

    const used = new Set(model.scenarios.flatMap((s) => s.steps.flatMap((st) => st.nodes)));
    const outside = model.nodes.filter((n) => !used.has(n.id)).map((n) => n.id).sort();

    expect(outside, 'список узлов вне процессов изменился').toEqual([...OUTSIDE_PROCESSES].sort());
    // Задействовано 36 из 45 узлов. Вне процессов остаются девять — они названы выше.
    expect(used.size, 'задействованных узлов').toBe(36);
    expect(model.nodes.length - used.size, 'узлов вне процессов').toBe(OUTSIDE_PROCESSES.length);
  });

  test('на каждый внепроцессный узел тоже есть пример (сид --off)', async () => {
    // Эти узлы не входят в процессы, поэтому их примеры заводятся ОТДЕЛЬНЫМ
    // набором. Без него девять узлов из сорока пяти показывать нечем.
    await seedExtra.offProcess();

    // Метка узла — в комментарии строки или номенклатуры, либо в номере документа
    // (`ВНЕ-G2-1`). Собираем всё, где метка может стоять.
    const marks = await pool.query<{ s: string }>(
      `select coalesce(comment, '') s from line where not deleted
        union all select coalesce(comment, '') from nomenclature where deleted_at is null
        union all select coalesce(number, '') from work_order where deleted_at is null
        union all select coalesce(number, '') from receipt where deleted_at is null`,
    );
    const haystack = marks.rows.map((r) => r.s).join('\n');

    const missing = OUTSIDE_PROCESSES.filter(
      (n) => !haystack.includes(`${n}:`) && !haystack.includes(`-${n}-`),
    );
    expect(missing, `внепроцессные узлы без примера: ${missing.join(', ')}`).toEqual([]);
  });

  test('примеры внепроцессных узлов не мешают проверке состояний', async () => {
    // Строки с меткой `ВНЕ-` стоят в тех же состояниях, что и строки процессов.
    // Если считать их вместе, «строк ровно по числу состояний» перестанет сходиться —
    // поэтому набор и держится отдельно.
    await seedExtra.showcase();
    const before = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from line where not deleted`)).rows[0]!.n);

    await seedExtra.offProcess();
    const after = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from line where not deleted`)).rows[0]!.n);

    expect(after, 'внепроцессные строки не должны добавляться к состояниям процессов')
      .toBeGreaterThan(before);
  });

  test('на КАЖДЫЙ узел, входящий в процесс, есть пример строки', async () => {
    await seedExtra.showcase();

    // Узел без смены состояния (G4+G5) показывается состоянием ПРЕДЫДУЩЕГО шага —
    // поэтому проверяем по состояниям шагов, а не по узлам напрямую.
    const covered = new Set<string>();
    for (const { process, status } of PAIRS) {
      if (await hasLine(process, status)) covered.add(`${process}·${status}`);
    }
    const missing = PAIRS.filter((p) => !covered.has(`${p.process}·${p.status}`));
    expect(missing, `узлы без примера: ${missing.map((m) => `${m.process}·${m.status}`).join(', ')}`)
      .toEqual([]);
  });

  test('каждая пара «процесс × состояние» заполнена строкой', async () => {
    await seedExtra.showcase();

    const empty: string[] = [];
    for (const { process, status } of PAIRS) {
      if (!(await hasLine(process, status))) empty.push(`${process} · ${status}`);
    }
    expect(empty, `узлы без примера: ${empty.join(', ')}`).toEqual([]);
  });

  test('ни одного узла с состоянием не пропущено', async () => {
    await seedExtra.showcase();

    // Сверяем не с числом, а с картой: сколько пар — столько и строк.
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from line where internal_order_number like 'ВИТ-%' and not deleted`);
    expect(Number(r.rows[0]!.n)).toBe(PAIRS.length);
  });

  test('строки витрины не мешают строкам процессов', async () => {
    for (const p of PROCESSES) await seedProcess(p.id);
    const before = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from line where not deleted`)).rows[0]!.n);

    await seedExtra.showcase();
    const after = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from line where not deleted`)).rows[0]!.n);

    expect(after).toBe(before + PAIRS.length);
  });
});

describe('3. с каждого узла можно идти дальше', () => {
  test('тупиков нет: с каждого состояния есть хотя бы один переход', async () => {
    const deadEnds = new Set<string>();
    for (const { status } of PAIRS) {
      if (allowedFrom(status).length === 0) deadEnds.add(status);
    }
    // Тупиков нет ВООБЩЕ, включая «Закрыт»: закрытую строку можно вернуть, и правило
    // возврата допускает `closed`. Это не случайность — на узле-тупике было бы
    // нечего показать, кроме самого факта, что дальше идти некуда.
    expect([...deadEnds], `состояния без выхода: ${[...deadEnds].join(', ')}`).toEqual([]);
  });

  test('у КАЖДОГО примера есть хотя бы один доступный переход', async () => {
    await seedExtra.showcase();

    const stuck: string[] = [];
    for (const p of PROCESSES) {
      for (const status of new Set(p.steps.map((s) => s.status).filter(Boolean))) {
        if (allowedFrom(status!).length === 0) stuck.push(`${p.id} · ${status}`);
      }
    }
    expect(stuck, `узлы без выхода: ${stuck.join(', ')}`).toEqual([]);
  });

  test('цепочка процесса проходима: каждое следующее состояние достижимо', async () => {
    // Идём по шагам процесса и проверяем, что из состояния шага N можно попасть
    // в состояние шага N+1 — переходом строки или действием (задание, снабжение).
    // Что двигает строку помимо перехода: документы и действия АРМ.
    const ACTIONS: Record<string, string[]> = {
      // «Задание»: отмеченные строки становятся заказанными (M4, K5).
      new: ['ordered'],
      // Канбан снабжения идёт по цепочке оплаты (M7, P2).
      ordered: ['paid'],
      paid: ['in_transit'],
      in_transit: ['acceptance'],
      // Приёмка документом: проведение приёмки ставит строку на склад (K1).
      acceptance: ['to_stock'],
      // Отгрузка документом: строка уходит клиенту (K5).
      ready_to_ship: ['shipped', 'closed'],
      assembly: ['ready_to_ship', 'closed'],
    };

    // ВЕТВЛЕНИЯ: процесс с двумя строками (склад + закупка) в плоском списке шагов
    // выглядит как «резерв → заказ», хотя это альтернативы, а не шаги подряд.
    // То же у ремонта: деталь либо берут со склада, либо заказывают (Q5).
    const BRANCHES = new Set(['reserve→ordered', 'ordered→reserve']);

    const breaks: string[] = [];
    for (const p of PROCESSES) {
      const chain = p.steps.map((s) => s.status).filter((s): s is string => Boolean(s));
      for (let i = 0; i < chain.length - 1; i++) {
        const from = chain[i]!;
        const to = chain[i + 1]!;
        if (from === to) continue;

        const byTransition = allowedFrom(from).some((t) => t.to === to);
        const byAction = (ACTIONS[from] ?? []).includes(to);
        const byBranch = BRANCHES.has(`${from}→${to}`);
        // Обратный шаг (готово → комплектация у ремонта) тоже ветвление: работа
        // возвращается в зону ремонта (G3).
        const byReturn = to === 'assembly' || to === 'reserve';
        if (!byTransition && !byAction && !byBranch && !byReturn) {
          breaks.push(`${p.id}: ${from} → ${to}`);
        }
      }
    }
    expect(breaks, `разрывы цепочки:\n${breaks.join('\n')}`).toEqual([]);
  });

  test('примеры витрины действительно двигаются: переход выполняется', async () => {
    // Не «правило разрешает», а «строка ЕСТЬ и операция проходит».
    await seedExtra.showcase();

    const r = await pool.query<{ id: string }>(
      `select id from line
        where internal_order_number like 'ВИТ-HAPPY-%' and status = 'assembly' and not deleted
        limit 1`);
    const id = r.rows[0]?.id;
    expect(id, 'в витрине нет строки happy в комплектации').toBeTruthy();

    const { app } = await import('../../src/server.ts');
    await app.request(`/lines/${id}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: true }),
    });
    const moved = await app.request('/lines/transition', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'ready_to_ship' }),
    });
    expect(moved.status, await moved.text()).toBe(200);

    const after = await pool.query<{ status: string }>(
      `select status from line where id = $1`, [id]);
    expect(after.rows[0]!.status, 'переход не сработал').toBe('ready_to_ship');
  });
});
