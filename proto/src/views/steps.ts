import { esc } from './html.ts';
import { neighbours, type StepInfo } from '../domain/step-move.ts';
import { statusTitle } from '../domain/status.ts';
import type { MarkedLine } from './chain.ts';

// ПАНЕЛЬ ДВИЖЕНИЯ ПО ШАГАМ ПРОЦЕССА.
//
// ГЛАВНОЕ ПРАВИЛО: строка идёт ТОЛЬКО на соседний шаг — вперёд до последнего, назад до
// первого. Не «в любое состояние, которое допускает граф», а строго следующий или
// предыдущий шаг.
//
// ПОЧЕМУ НЕ ГРАФ СОСТОЯНИЙ. У одного состояния бывает НЕСКОЛЬКО шагов: «Новый» стоит на
// шагах 1, 2 и 3 почти каждого процесса. По графу строка могла бы «перейти из нового в
// новый», перескочив шаг, — и учёт показал бы, что работа идёт, хотя её не делали.
//
// НА ГРАНИЦАХ КНОПОК НЕТ, И ЭТО СКАЗАНО СЛОВАМИ. Пустая кнопка или кнопка, которая ничего
// не делает, хуже отсутствующей: оператор жмёт и не понимает, почему нет результата.
// Поэтому на последнем шаге прямо написано «процесс завершён», на первом — «начало
// процесса».
//
// ЧТОБЫ ДВИГАТЬ ВМЕСТЕ, СТРОКИ ДОЛЖНЫ СТОЯТЬ НА ОДНОМ ШАГЕ. Иначе одна ушла бы на шаг
// вперёд, а другая на два — и «вперёд» для них значило бы разное.

/** Общая точка отмеченных строк: процесс и шаг. `null` — общей нет. */
function commonPoint(lines: MarkedLine[]): { processId: string; step: number } | null {
  if (lines.length === 0) return null;
  const first = lines[0]!;
  if (!first.processId || first.processStep === null || first.processStep === undefined) return null;
  const same = lines.every((l) => l.processId === first.processId && l.processStep === first.processStep);
  return same ? { processId: first.processId, step: first.processStep } : null;
}

/** Подпись шага: номер, состояние и узлы. По узлам и видно, куда строка пойдёт. */
function stepLabel(s: StepInfo): string {
  const nodes = s.nodes.join(' · ');
  return `шаг ${s.n}, узел ${nodes} — ${statusTitle(s.status)}`;
}

/**
 * Панель движения по шагам.
 *
 * Возвращает пустую строку, если строки ВНЕ ПРОЦЕССА: тогда работает прежняя панель
 * переходов по состояниям, и подменять её нельзя — для строки без процесса «следующий шаг»
 * не определён.
 */
export function stepsPanel(lines: MarkedLine[]): string {
  const point = commonPoint(lines);
  if (!point) return '';

  const nb = neighbours(point.processId, point.step);
  if (nb.total === 0) return '';

  const back = nb.back
    ? `<button type="button" data-testid="step-prev"
        hx-post="/ui/lines/step" hx-vals='{"dir":"prev"}'
        hx-target="#lines-panel" hx-swap="outerHTML"
        title="${esc(stepLabel(nb.back))}">← Назад</button>`
    : '<span class="hint" data-testid="step-start">начало процесса</span>';

  const forward = nb.forward
    ? `<button type="button" data-testid="step-next"
        hx-post="/ui/lines/step" hx-vals='{"dir":"next"}'
        hx-target="#lines-panel" hx-swap="outerHTML"
        title="${esc(stepLabel(nb.forward))}">Вперёд →</button>`
    : '<span class="hint" data-testid="step-end">процесс завершён</span>';

  return `<div class="steps-panel" data-testid="steps-panel" data-process="${esc(point.processId)}"
   data-step="${point.step}">
 <span class="hint" data-testid="steps-where">Процесс ${esc(point.processId)}, шаг
   <strong>${point.step}</strong> из ${nb.total}</span>
 <span class="buttons">${back} ${forward}</span>
</div>`;
}
