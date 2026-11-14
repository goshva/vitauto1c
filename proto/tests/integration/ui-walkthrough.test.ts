import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { PROCESSES } from '../../src/domain/process-map.ts';

// Проверка ПРОХОДИМОСТИ через интерфейс: каждый заказ двигается по процессу,
// и на каждом узле есть чем двигать.
//
// Отличие от `processes.spec.ts` (e2e): там процесс проходится вызовами API.
// Здесь — ТЕМИ ЖЕ адресами, что нажимает оператор в браузере (`/ui/...`, HTMX).
// Разница существенная: API может уметь переход, до которого в интерфейсе нет
// кнопки, и оператор об этом не узнает. Ровно так и вышло с `to_stock`: правило
// канбана было, кнопки не было.

const UI = '/ui/lines';

const html = async (url: string, init?: RequestInit) =>
  (await app.request(url, { headers: { accept: 'text/html' }, ...init }));

const uiPost = (url: string, body: Record<string, string>) =>
  app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

/** Отметить строку так, как это делает флажок в списке. */
const mark = (id: string) => uiPost(`${UI}/${id}/toggle`, { marked: 'true' });

/** Нажать кнопку перехода. */
const transition = (to: string) => uiPost(`${UI}/transition`, { to });

/** Кнопки, доступные оператору прямо сейчас. */
async function buttons(id: string): Promise<string[]> {
  await mark(id);
  const body = await (await html('/lines')).text();
  return [...body.matchAll(/data-testid="(action-[a-z_]+|chain-[a-z_-]+)"/g)]
    .map((m) => m[1]!);
}

const statusOf = async (id: string): Promise<string> =>
  (await pool.query<{ status: string }>(`select status from line where id = $1`, [id]))
    .rows[0]!.status;

/** Первая строка сида указанного процесса. */
const seedFirstLine = async (processId: string): Promise<string> => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess(processId);
  return String((await pool.query<{ id: string }>(
    `select id from line where not deleted order by order_date, id limit 1`)).rows[0]!.id);
};

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('цепочка проходится ЦЕЛИКОМ через интерфейс', () => {
  test('от «Новый» до «Закрыт» — только кнопками', async () => {
    const id = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await mark(id);

    // 1. Задание: new → ordered
    await uiPost(`${UI}/job`, {});
    expect(await statusOf(id), 'задание не сработало').toBe('ordered');

    // 2. Канбан снабжения: ordered → paid → in_transit → acceptance → to_stock
    for (const code of ['paid', 'in_transit', 'acceptance', 'to_stock']) {
      await mark(id);
      const r = await uiPost(`${UI}/supply`, { status: code });
      expect(r.status, `кнопка «${code}» не отвечает`).toBe(200);
    }
    expect(await statusOf(id), 'канбан снабжения не довёл до склада').toBe('to_stock');

    // 3. Комплектация → собрано
    for (const [code, want] of [['assembly', 'assembly'], ['assembled', 'ready_to_ship']] as const) {
      await mark(id);
      await uiPost(`${UI}/supply`, { status: code });
      expect(await statusOf(id), `кнопка «${code}» не сработала`).toBe(want);
    }

    // 4. Закрытие — кнопкой перехода
    await mark(id);
    const closed = await transition('closed');
    expect(closed.status).toBe(200);
    expect(await statusOf(id), 'наряд не закрылся').toBe('closed');
  });

  test('каждый шаг цепочки ВИДЕН оператору кнопкой', async () => {
    const id = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);

    // На «Новом» доступны и переход, и задание, и канбан.
    const atNew = await buttons(id);
    expect(atNew, 'нет кнопки резерва').toContain('action-reserve');
    expect(atNew, 'нет кнопки отмены').toContain('action-cancelled');
    expect(atNew, 'нет кнопки задания').toContain('chain-job');
    expect(atNew, 'нет канбана снабжения').toContain('chain-supply-paid');
  });

  test('кнопки канбана закрывают ВСЮ цепочку снабжения, без пропусков', async () => {
    const id = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    const seen = await buttons(id);

    // Каждое правило канбана должно иметь кнопку: пропуск = недостижимый узел.
    for (const code of ['paid', 'in_transit', 'acceptance', 'to_stock', 'assembly', 'assembled']) {
      expect(seen, `правило канбана «${code}» без кнопки — узел недостижим`)
        .toContain(`chain-supply-${code}`);
    }
  });
});

describe('каждый процесс двигается через интерфейс', () => {
  test('у всех 11 процессов первый узел берётся кнопкой', async () => {
    const stuck: string[] = [];
    for (const p of PROCESSES) {
      const id = await seedFirstLine(p.id);
      const seen = await buttons(id);
      // Хотя бы одно действие должно быть доступно: иначе заказ мёртв.
      const actionable = seen.some((b) => b.startsWith('action-') || b.startsWith('chain-'));
      if (!actionable) stuck.push(`${p.id} (статус ${await statusOf(id)})`);
    }
    expect(stuck, `процессы без доступных действий: ${stuck.join(', ')}`).toEqual([]);
  });

  test('на КАЖДОМ узле процесса есть чем двигать дальше', async () => {
    // Берём витрину: в ней строка на каждый узел каждого процесса. Для каждой
    // проверяем, что оператор видит хотя бы одно действие.
    await seedExtra.showcase();

    const stuck: string[] = [];
    for (const p of PROCESSES) {
      const rows = await pool.query<{ id: string; status: string }>(
        `select id, status from line
          where internal_order_number like $1 and not deleted
          order by internal_order_number`,
        [`ВИТ-${p.id.toUpperCase().slice(0, 8)}-%`],
      );
      for (const r of rows.rows) {
        const seen = await buttons(r.id);
        const actionable = seen.some((b) => b.startsWith('action-') || b.startsWith('chain-'));
        if (!actionable) stuck.push(`${p.id} · ${r.status}`);
        await uiPost(`${UI}/${r.id}/toggle`, { marked: 'false' });
      }
    }
    expect(stuck, `узлы без выхода: ${stuck.join(', ')}`).toEqual([]);
  });
});

describe('статические списки интерфейса не разошлись с базой', () => {
  const src = readFileSync('src/views/actions.ts', 'utf8');

  const grab = (name: string): { id: string; title: string }[] => {
    const at = src.indexOf(`const ${name} = [`);
    const end = src.indexOf('];', at);
    return [...src.slice(at, end).matchAll(
      /\{ id: '([0-9a-f-]+)', (?:title|code): '([^']+)' \}/g,
    )].map((m) => ({ id: m[1]!, title: m[2]! }));
  };

  test('все зоны интерфейса существуют в справочнике', async () => {
    // ЭТОТ ТЕСТ — тот самый, который был обещан в комментарии к списку зон, но
    // не написан. Без него список разошёлся с сидом: после слияния «Неопознанных»
    // и «Возвратов» интерфейс продолжал предлагать удалённую зону.
    const rows = await pool.query<{ id: string }>(
      `select id from warehouse_zone where deleted_at is null`);
    const real = new Set(rows.rows.map((r) => r.id));

    const missing = grab('ZONES').filter((z) => !real.has(z.id));
    expect(missing, `зон нет в справочнике: ${missing.map((m) => m.title).join(', ')}`).toEqual([]);
  });

  test('все зоны справочника есть в интерфейсе', async () => {
    const rows = await pool.query<{ id: string }>(
      `select id from warehouse_zone where deleted_at is null`);
    const inUi = new Set(grab('ZONES').map((z) => z.id));
    const missing = rows.rows.filter((r) => !inUi.has(r.id));
    expect(missing, `зон нет в списке интерфейса: ${missing.length}`).toEqual([]);
  });

  test('названия зон совпадают со справочником дословно', async () => {
    const rows = await pool.query<{ id: string; name: string }>(
      `select id, name from warehouse_zone where deleted_at is null`);
    const real = new Map(rows.rows.map((r) => [r.id, r.name]));

    const wrong = grab('ZONES')
      .filter((z) => real.has(z.id) && real.get(z.id) !== z.title)
      .map((z) => `«${z.title}» против «${real.get(z.id)}»`);
    expect(wrong, `названия разошлись: ${wrong.join('; ')}`).toEqual([]);
  });

  test('все ячейки интерфейса существуют в справочнике', async () => {
    const rows = await pool.query<{ id: string }>(
      `select id from storage_cell where deleted_at is null`);
    const real = new Set(rows.rows.map((r) => r.id));

    const missing = grab('CELLS').filter((c) => !real.has(c.id));
    expect(missing, `ячеек нет: ${missing.map((m) => m.title).join(', ')}`).toEqual([]);
  });

  test('у каждого правила канбана есть кнопка — иначе узел недостижим', () => {
    const rules = [...readFileSync('src/lines-ui-actions.ts', 'utf8')
      .slice(readFileSync('src/lines-ui-actions.ts', 'utf8').indexOf('const SUPPLY'))
      .matchAll(/^  (\w+): \{ to:/gm)].map((m) => m[1]!);
    const buttons = [...src.matchAll(/code: '(\w+)', title:/g)].map((m) => m[1]!);

    const withoutButton = rules.filter((r) => !buttons.includes(r));
    expect(withoutButton, `правила без кнопки: ${withoutButton.join(', ')}`).toEqual([]);
  });
});
