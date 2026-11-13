import { esc } from './html.ts';
import { statusTitle } from '../domain/status.ts';
import { ROLE_TITLES, type Process, TOTAL_STEPS, PROCESSES } from '../domain/process-map.ts';

// Карта процессов: общая схема, переключение на процесс, статистика.
//
// Схема связана с ДАННЫМИ: у каждого шага известно состояние строки, и рядом
// показано, сколько строк в нём сейчас. Без этого карта была бы картинкой из ТЗ.

export interface StatusCount {
  status: string;
  lines: number;
}

/** Статистика по состояниям: сколько строк где. */
export function statsByStatus(counts: StatusCount[]): string {
  if (counts.length === 0) {
    return '<p data-testid="stats-empty">Строк пока нет — загрузите лист или накатите сид процесса.</p>';
  }

  const total = counts.reduce((s, c) => s + c.lines, 0);
  const rows = counts
    .map((c) => `<tr data-testid="stat-${esc(c.status)}">
      <td class="c-status s-${esc(c.status)}">${esc(statusTitle(c.status))}</td>
      <td class="c-num">${c.lines}</td>
      <td><a href="/lines?status=${esc(c.status)}" data-testid="stat-link-${esc(c.status)}">показать</a></td>
    </tr>`)
    .join('\n');

  return `<table class="stats" data-testid="stats-by-status">
    <caption>Сейчас в работе: <strong data-testid="stats-total">${total}</strong> строк</caption>
    <thead><tr><th>Состояние</th><th class="c-num">Строк</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** Список процессов: по нему переключаются на карточку. */
export function processList(active: string | null): string {
  const cards = PROCESSES.map(
    (p) => `<a class="proc-card${p.id === active ? ' proc-active' : ''}"
      href="/processes/${esc(p.id)}" data-testid="process-${esc(p.id)}"
      hx-get="/ui/processes/panel?process=${esc(p.id)}"
      hx-target="#process-panel" hx-swap="outerHTML"
      hx-push-url="/processes/${esc(p.id)}">
      <span class="proc-title">${esc(p.title)}</span>
      <span class="proc-steps">${p.steps.length} шагов</span>
    </a>`,
  ).join('\n');

  return `<nav class="proc-list" data-testid="process-list">${cards}</nav>`;
}

/** Схема одного процесса: шаги со состояниями и счётчиком строк. */
export function processScheme(process: Process, counts: StatusCount[]): string {
  const byStatus = new Map(counts.map((c) => [c.status, c.lines]));

  const steps = process.steps
    .map((s) => {
      const count = s.status ? (byStatus.get(s.status) ?? 0) : null;
      const roles = s.roles.map((r) => ROLE_TITLES[r] ?? r).join(', ');
      const status = s.status
        ? `<span class="c-status s-${esc(s.status)}" data-testid="step-status-${s.n}">${esc(statusTitle(s.status))}</span>`
        : '<span class="empty">—</span>';
      const counter = count === null
        ? ''
        : `<span class="step-count${count > 0 ? ' step-count-live' : ''}"
             data-testid="step-count-${s.n}">${count}</span>`;

      return `<li class="step" data-testid="step-${s.n}">
        <span class="step-n">${s.n}</span>
        <span class="step-body">
          <span class="step-title">${esc(s.titles.join(' + '))}</span>
          <span class="step-role">${esc(roles)}</span>
          ${s.note ? `<span class="step-note">${esc(s.note)}</span>` : ''}
        </span>
        <span class="step-state">${status}${counter}</span>
      </li>`;
    })
    .join('\n');

  return `<div id="process-panel" data-testid="process-panel" data-process="${esc(process.id)}">
    <h2 data-testid="process-title">${esc(process.title)}</h2>
    <p class="hint">Шагов: <strong>${process.steps.length}</strong> · узлов: <strong>${new Set(process.steps.flatMap((s) => s.nodes)).size}</strong></p>
    <ol class="scheme" data-testid="process-scheme">${steps}</ol>
  </div>`;
}

/** Заголовок общей страницы: сколько всего. */
export function mapSummary(): string {
  return `<p class="hint" data-testid="map-summary">
    Процессов: <strong>${PROCESSES.length}</strong> ·
    шагов: <strong>${TOTAL_STEPS}</strong>.
    Выберите процесс, чтобы увидеть схему и состояние строк на каждом шаге.
  </p>`;
}
