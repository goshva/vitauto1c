import { Hono } from 'hono';
import type { Context } from 'hono';
import { pool } from './db.ts';
import { roleOf } from './auth.ts';
import { layout } from './views/html.ts';
import { linesTable } from './views/lines.ts';
import { actionsPanel, type MarkedLine } from './views/actions.ts';
import { importPanel } from './lines-import-panel.ts';
import { filtersPanel, type FilterValues } from './views/filters.ts';
import { filterCount, filtersOf, type LineFilters } from './lines-filters.ts';
import { loadRows } from './lines-query.ts';
import { Problem, problemResponse } from './problem.ts';

// Экраны АРМ на HTMX.
//
// ПОЧЕМУ `Accept`, а не отдельный префикс `/ui`: адрес `/lines` — это адрес экрана,
// и он должен остаться им. Браузер просит `text/html` и получает страницу,
// тест и агент просят JSON и получают данные. Один URL — два представления,
// дублирования маршрутов нет.
//
// Действия вынесены под `/ui/lines/*`: у них нет JSON-двойника, и смешивать их
// с API-маршрутами (`POST /lines/transition` уже занят JSON-версией) нельзя.

export const linesUi = new Hono();

/** Клиент просит HTML? HTMX всегда добавляет `HX-Request`. */
export function wantsHtml(c: Context): boolean {
  if (c.req.header('hx-request')) return true;
  return (c.req.header('accept') ?? '').includes('text/html');
}

async function loadMarked(): Promise<MarkedLine[]> {
  // ПРОЦЕСС И ШАГ ЧИТАЮТСЯ ВМЕСТЕ СО СОСТОЯНИЕМ: по ним панель решает, показывать ли
  // движение по шагам. Отдельным запросом это дало бы второй ответ на тот же вопрос.
  const r = await pool.query<MarkedLine>(
    `select id, status, process_id as "processId", process_step as "processStep"
       from line
      where id in (select id from line_mark where marked) and not deleted`,
  );
  return r.rows;
}

/**
 * Панель действий — отдельным блоком: её же отдают обработчики действий.
 */
export function actionsBlock(marked: MarkedLine[]): string {
  return `<div id="actions">${actionsPanel(marked)}</div>`;
}

/**
 * ОБЛАСТЬ СПИСКА: панель действий, переключатель раздела, отбор и таблица — ОДНИМ БЛОКОМ.
 *
 * ПОЧЕМУ ОДНИМ. Панель действий стоит выше строки отбора, таблица — ниже, но обновляться они
 * должны ВМЕСТЕ: отметил строку — появились кнопки, сменил отбор — пересчитался список.
 *
 * Сначала я связал их `hx-swap-oob` — и получил ДВЕ панели действий на экране: HTMX брал
 * первый элемент ответа как содержимое цели. Общий блок решает это без хитростей; плата —
 * панель отбора перерисовывается при каждом изменении, и её значения приходят С СЕРВЕРА.
 */
export async function linesPanel(operation: string, filters: FilterValues, /**
   * Роль: по ней таблица решает, какие колонки показывать.
   *
   * БЕЗ ЗНАЧЕНИЯ ПО УМОЛЧАНИЮ, И ЭТО ГЛАВНОЕ ЗДЕСЬ. Сначала стояло `role = 'admin'` — и
   * это была ловушка: забыл передать, компилятор молчит, а таблица показывает ВСЁ. То есть
   * умолчание означало не «безопасно», а «показать всё» — ровно то, чего быть не должно.
   *
   * Так и вышло: роль донесли до четырёх вызовов из шести, а два забыли. Страница рисовала
   * таблицу без цен, а HTMX-фрагмент после отметки строки приходил С ценами — таблица
   * менялась на глазах.
   *
   * Теперь забыть нельзя: TypeScript назовёт каждое место.
   */
  role: string,
): Promise<string> {
  const [rows, marked] = await Promise.all([loadRows(operation, filters), loadMarked()]);
  const active = filterCount({ ...filters, view: 'sales' } as LineFilters);

  return `<div id="lines-panel" data-testid="lines-panel" data-rows="${rows.length}">
  ${actionsBlock(marked)}
  <form class="filter" data-testid="view-filter">
    <label><input type="radio" name="view" value="sales" data-testid="view-sales"
      ${operation === 'sale' ? 'checked' : ''}
      hx-get="/ui/lines/panel" hx-vals='{"view":"sales"}' hx-target="#lines-panel" hx-swap="outerHTML"> Продажи</label>
    <label><input type="radio" name="view" value="purchases" data-testid="view-purchases"
      ${operation === 'purchase' ? 'checked' : ''}
      hx-get="/ui/lines/panel" hx-vals='{"view":"purchases"}' hx-target="#lines-panel" hx-swap="outerHTML"> Закупки</label>
  </form>
  ${filtersPanel(filters, { operation, active })}
  ${rows.length === 0 && active > 0
    ? `<p class="hint" data-testid="lines-filtered-empty">
         Под заданный отбор не подходит ни одна строка.
         <a href="/lines">Сбросить отбор</a>.
       </p>`
    : ''}
  ${linesTable(rows, operation, role)}
</div>`;
}

/** Страница целиком: панель вставки и область списка. */
async function linesPage(operation: string, filters: FilterValues, role: string): Promise<string> {
  return layout({
    active: 'lines',
    title: 'Строки заказов',
    testId: 'page-lines',
    body: `${importPanel()}
    ${await linesPanel(operation, filters, role)}`,
  });
}

const operation = (view: string | undefined): string => (view === 'purchases' ? 'purchase' : 'sale');

// --- GET /lines/panel — фрагмент (обновление списка и фильтра) -------------------------
//
// Один адрес и для смены раздела, и для отбора: два адреса разошлись бы, и отбор
// терялся бы при переключении «Продажи / Закупки».
//
// Разбор строки запроса живёт в `lines-filters.ts` — рядом с правилами отбора, а не
// в этом файле: он тоже часть контракта фильтра.
linesUi.get('/ui/lines/panel', async (c) => {
  const op = operation(c.req.query('view'));
  return c.html(await linesPanel(op, filtersOf(c.req.query()) as FilterValues, roleOf(c)));
});

// --- POST /lines/{id}/toggle — отметка переключателем ---------------------------------
linesUi.post('/ui/lines/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const exists = await pool.query(`select 1 from line where id = $1 and not deleted`, [id]);
  if (exists.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }
  // Переключаем: клик по флажку — это «перевернуть», а не «поставить true».
  await pool.query(
    `insert into line_mark (id, marked) values ($1, true)
     on conflict (id) do update set marked = not line_mark.marked`,
    [id],
  );
  return c.html(await linesPanel(operation(c.req.query('view')), {}, roleOf(c)));
});

// --- POST /ui/lines/unmark — снять выделение со всех ----------------------------------
//
// Нужен там, где переход доступен не для всех отмеченных строк: единственное осмысленное
// действие в этом случае — снять выделение и отметить заново. Сообщение об этом несёт
// кнопку, ведущую сюда.
linesUi.post('/ui/lines/unmark', async (c) => {
  const form = await c.req.parseBody();
  const op = operation(typeof form.view === 'string' ? form.view : undefined);
  await pool.query(`update line_mark set marked = false where marked`);
  return c.html(await linesPanel(op, {}, roleOf(c)));
});

// --- POST /ui/lines/step — сдвиг по шагам процесса ------------------------------------
//
// ДЕЛЕГИРУЕТ в API, как и переход: там же проверки границ и запись в журнал. Вторая копия
// правила разошлась бы с первой — ровно тот класс дефектов, от которого проект уходил.
linesUi.post('/ui/lines/step', async (c) => {
  const form = await c.req.parseBody();
  const dir = String(form.dir ?? 'next');
  const op = operation(typeof form.view === 'string' ? form.view : undefined);

  const { app } = await import('./server.ts');
  await app.request('/lines/step', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir }),
  });

  return c.html(await linesPanel(op, {}, roleOf(c)));
});

// --- POST /ui/lines/transition — переход по отмеченным --------------------------------
//
// ДЕЛЕГИРУЕТ в API, а не повторяет его логику.
//
// Здесь стояла ВТОРАЯ КОПИЯ перехода: те же проверки, тот же `update line`, тот же
// сброс отметок. Две копии одного правила — это ровно тот класс дефектов, от
// которого проект и уходил (C21: таблица переходов была продублирована четырежды и
// разошлась). Уведомления АРМ (ФТ v2 п. 17), добавленные в API, в копию не попали бы
// вовсе — и из интерфейса они бы не создавались.
//
// Теперь адрес один. Экран лишь передаёт запрос и перерисовывает панель.
linesUi.post('/ui/lines/transition', async (c) => {
  const form = await c.req.parseBody();
  const to = String(form.to ?? '');
  const op = operation(typeof form.view === 'string' ? form.view : undefined);

  const { app } = await import('./server.ts');
  await app.request('/lines/transition', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to }),
  });

  // Панель возвращается целиком: и список, и кнопки пересчитываются на сервере.
  return c.html(await linesPanel(op, {}, roleOf(c)));
});

export { linesPage, wantsHtml as htmlRequested };
