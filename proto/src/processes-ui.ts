import { Hono } from 'hono';
import { pool } from './db.ts';
import { layout } from './views/html.ts';
import {
  mapSummary,
  processList,
  processScheme,
  statsByStatus,
  type StatusCount,
} from './views/processes.ts';
import { PROCESSES, processById } from './domain/process-map.ts';

// Карта процессов как часть приложения (3 маршрута).
//
// Раньше в шапке была ссылка на статичный `/process.html` — файл из legacy-приложения,
// которого в прототипе нет: переход вёл в 404. Схема стала страницей прототипа,
// связанной с данными.
//
// Схема живёт на СЕРВЕРЕ, как и всё остальное: переключение процесса — HTMX-запрос
// за фрагментом, а не клиентская отрисовка. Иначе понадобился бы второй экземпляр
// схемы на клиенте, и он разошёлся бы с серверным.

export const processesUi = new Hono();

/**
 * Сколько строк сейчас в каждом состоянии.
 *
 * Считается по БАЗЕ, а не по модели: карта показывает текущую работу, а не то,
 * как она должна выглядеть по ТЗ.
 */
async function statusCounts(): Promise<StatusCount[]> {
  const r = await pool.query<{ status: string; n: string }>(
    `select status, count(*)::text as n
       from line where not deleted
      group by status order by status`,
  );
  return r.rows.map((x) => ({ status: x.status, lines: Number(x.n) }));
}

// --- GET /processes — общая схема -----------------------------------------------------

processesUi.get('/processes', async (c) => {
  const counts = await statusCounts();
  const first = PROCESSES[0]!;

  return c.html(
    layout({
      title: 'Карта процессов',
      testId: 'page-processes',
      body: `${mapSummary()}
      ${statsByStatus(counts)}
      ${processList(first.id)}
      ${processScheme(first, counts)}`,
    }),
  );
});

// --- GET /ui/processes/panel — фрагмент для переключения процесса ---------------------

processesUi.get('/ui/processes/panel', async (c) => {
  const id = c.req.query('process') ?? '';
  const process = processById(id);

  if (!process) {
    const list = PROCESSES.map((p) => p.id).join(', ');
    return c.html(
      `<div id="process-panel" data-testid="process-panel">
        <p class="hint-partial" data-testid="process-error">Процесса «${id}» нет. Есть: ${list}</p>
      </div>`,
      404,
    );
  }

  return c.html(processScheme(process, await statusCounts()));
});

// --- GET /processes/{id} — карточка процесса по ссылке --------------------------------

processesUi.get('/processes/:id', async (c) => {
  const id = c.req.param('id');
  const process = processById(id);

  if (!process) {
    const list = PROCESSES.map((p) => p.id).join(', ');
    return c.html(
      layout({
        title: 'Процесс не найден',
        testId: 'page-process-missing',
        body: `<p data-testid="process-error">Процесса «${id}» нет. Есть: ${list}</p>
          <p><a href="/processes">Вернуться к карте процессов</a></p>`,
      }),
      404,
    );
  }

  const counts = await statusCounts();
  return c.html(
    layout({
      title: process.title,
      testId: `page-process-${process.id}`,
      body: `${mapSummary()}
      ${statsByStatus(counts)}
      ${processList(process.id)}
      ${processScheme(process, counts)}`,
    }),
  );
});
