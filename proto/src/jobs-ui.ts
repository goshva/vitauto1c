import { Hono } from 'hono';
import { pool } from './db.ts';
import { guard, roleOf } from './auth.ts';
import { problemResponse, Problem } from './problem.ts';
import { layout, esc } from './views/html.ts';
import { jobStates, runJob, type JobState } from './jobs-run.ts';
import { jobByName } from './jobs.ts';

// Экран регламентных заданий: что должно происходить само и что из этого произошло.
//
// ГЛАВНОЕ НА ЭКРАНЕ — НЕ СПИСОК ЗАДАНИЙ, А ПОКАЗАТЕЛЬ ПРОСРОЧКИ. Задание, которое
// тихо перестало запускаться, выглядит как работающее; заметить это можно только по
// строке «не запускалось 40 часов при сроке 24». Поэтому просрочка стоит первой и
// выделена, а не спрятана в таблицу истории.

export const jobsUi = new Hono();

interface RunRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  message: string | null;
  startedBy: string | null;
  durationMs: number | null;
}

async function history(limit = 30): Promise<RunRow[]> {
  const r = await pool.query<{
    id: string; started_at: Date; finished_at: Date | null; status: string;
    message: string | null; started_by: string | null; duration_ms: number | null;
  }>(
    `select id, started_at, finished_at, status, message, started_by, duration_ms
       from scheduled_job_run
      order by started_at desc
      limit $1`,
    [limit],
  );
  return r.rows.map((x) => ({
    id: x.id,
    startedAt: x.started_at.toISOString(),
    finishedAt: x.finished_at === null ? null : x.finished_at.toISOString(),
    status: x.status,
    message: x.message,
    startedBy: x.started_by,
    durationMs: x.duration_ms,
  }));
}

const when = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** «5 ч назад» читается быстрее, чем дата, когда вопрос «пора или нет». */
function ago(hours: number | null): string {
  if (hours === null) return 'ни разу';
  if (hours < 1) return 'меньше часа назад';
  if (hours < 48) return `${Math.floor(hours)} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

const STATUS_TITLES: Record<string, string> = {
  ok: 'выполнено',
  failed: 'ОШИБКА',
  running: 'идёт',
};

function jobCard(s: JobState): string {
  const alarm = s.overdue ? ' job-alarm' : '';
  return `<div class="job${alarm}" data-testid="job-${esc(s.name)}">
  <div class="job-head">
    <b>${esc(s.title)}</b>
    <span class="hint">${esc(s.schedule)}</span>
    ${
    s.overdue
      ? `<span class="job-badge" data-testid="job-overdue-${esc(s.name)}">ПРОСРОЧЕНО: ${esc(ago(s.hoursSince))} при сроке ${s.everyHours} ч</span>`
      : s.running
        ? `<span class="job-badge job-badge-run" data-testid="job-running-${esc(s.name)}">идёт сейчас</span>`
        : `<span class="hint" data-testid="job-last-${esc(s.name)}">последний пуск: ${esc(ago(s.hoursSince))}</span>`
  }
  </div>
  <p class="hint">${esc(s.purpose)}</p>
  ${
    s.failedStreak > 0
      ? `<p class="hint-partial" data-testid="job-failed-${esc(s.name)}">
           Не получилось ${s.failedStreak} раз подряд. Последняя причина — в истории ниже.
         </p>`
      : ''
  }
  <form hx-post="/ui/jobs/${esc(s.name)}/run" hx-target="#jobs-panel" hx-swap="outerHTML"
        data-testid="job-run-form-${esc(s.name)}">
    <button type="submit" data-testid="job-run-${esc(s.name)}">Запустить сейчас</button>
    <span class="hint">Ручной пуск сдвигает срок следующего.</span>
  </form>
</div>`;
}

function historyTable(rows: RunRow[]): string {
  if (rows.length === 0) {
    return `<p class="hint" data-testid="jobs-no-history">
      Запусков не былоапусков не было. Задания поднимаются вместе с приложением и проверяются раз в
      минуту; если приложение только что запущено, первый проход может быть не сразу.
    </p>`;
  }

  return `<table class="audit" data-testid="jobs-history">
  <thead><tr>
    <th>Когда</th><th>Задание</th><th>Итог</th><th>Что сделано</th><th class="c-num">Время</th>
  </tr></thead>
  <tbody>
${rows.map((x) => `  <tr data-testid="run-${esc(x.id)}"${
    x.status === 'failed' ? ' class="row-urgent"' : ''}>
    <td class="c-nowrap">${esc(when(x.startedAt))}</td>
    <td>${esc(x.startedBy ?? 'расписание')}</td>
    <td>${esc(STATUS_TITLES[x.status] ?? x.status)}</td>
    <td>${esc(x.message ?? '—')}</td>
    <td class="c-num">${x.durationMs === null ? '—' : `${Math.round(x.durationMs / 1000)} с`}</td>
  </tr>`).join('\n')}
  </tbody>
</table>`;
}

/** Панель целиком: состояние заданий + история. HTMX подменяет её после запуска. */
export async function jobsPanel(): Promise<string> {
  const [states, rows] = await Promise.all([jobStates(), history()]);
  const overdue = states.filter((s) => s.overdue);

  return `<div id="jobs-panel" data-testid="jobs-panel" data-overdue="${overdue.length}">
  ${
    overdue.length > 0
      ? `<p class="hint-partial" data-testid="jobs-alarm">
           Не запускались вовремя: ${overdue.map((s) => esc(s.title)).join(', ')}.
           Проверьте, работает ли приложение и не выключено ли задание вручную.
         </p>`
      : `<p class="hint" data-testid="jobs-all-ok">Все задания выполняются по расписанию.</p>`
  }

  ${states.map(jobCard).join('\n')}

  <h3>История пусков</h3>
  ${historyTable(rows)}
</div>`;
}

// --- GET /jobs — экран (администратор) ------------------------------------------------
jobsUi.get('/jobs', async (c) => {
  const noRight = guard(c, 'job.run');
  if (noRight) return problemResponse(c, noRight);

  return c.html(layout({
    title: 'Регламентные задания',
    testId: 'page-jobs',
    active: 'jobs',
    role: roleOf(c),
    body: `<p class="hint" data-testid="jobs-hint">
      Задания поднимаются вместе с приложением и проверяются раз в минуту. Пропущенное
      догоняется при следующем старте: срок считается по «прошло ли больше положенного»,
      а не по календарю.
    </p>${await jobsPanel()}`,
  }));
});

// --- POST /ui/jobs/{name}/run — запустить вручную -------------------------------------
jobsUi.post('/ui/jobs/:name/run', async (c) => {
  const noRight = guard(c, 'job.run');
  if (noRight) return problemResponse(c, noRight);

  const name = c.req.param('name');
  if (!jobByName(name)) {
    return problemResponse(c, new Problem(404, 'not_found', `Задание «${name}» не найдено`));
  }

  // Ждём окончания: копия занимает секунды, а показать «запущено» и не сказать, чем
  // кончилось, — это ровно та неясность, из-за которой задания и перестают замечать.
  const result = await runJob(name, `admin`);

  return c.html(
    `<div id="jobs-panel" data-testid="jobs-panel" data-just-run="${esc(name)}">
      <p class="${result.status === 'ok' ? 'hint' : 'hint-partial'}"
         data-testid="jobs-run-result">
        ${esc(jobByName(name)!.title)}: ${
      result.status === 'ok' ? 'выполнено' : 'ОШИБКА'} за ${
      Math.round(result.durationMs / 1000)} с — ${esc(result.message)}
      </p>
      ${await jobsPanel()}
    </div>`,
    result.status === 'ok' ? 200 : 500,
  );
});
