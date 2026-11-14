import { allowedFrom, TRANSITIONS, type Transition } from '../domain/transition.ts';
import { esc } from './html.ts';
import { chainPanel, type MarkedLine } from './chain.ts';

// Панель действий. Кнопки строятся из ТОЙ ЖЕ таблицы, что проверяет API
// (`src/domain/transition.ts`) — поэтому кнопка не может появиться там, где
// переход запрещён. Именно этого не хватало в legacy: таблица была продублирована
// четырежды, и кнопка `reserve` показывалась для `partially_ordered`, а бэкенд
// строку молча пропускал (C21).
//
// При смешанных статусах показываем ПЕРЕСЕЧЕНИЕ: кнопка работает только если
// переход допустим для всех отмеченных строк. Иначе оператор нажал бы кнопку
// и получил «обработано 0».
//
// Действия ЦЕПОЧКИ (задание, закупка, канбан, зона, ячейка, печать) живут в
// `chain.ts` — разделение по смыслу: здесь переходы состояния из домена, там
// действия из справочников и канбана.

export type { MarkedLine };

/** Человеческое объяснение, почему кнопки нет. */
function hint(lines: MarkedLine[]): string {
  if (lines.length === 0) return 'Отметьте строки в списке';
  const statuses = [...new Set(lines.map((l) => l.status))];
  return statuses.length === 1
    ? `Отмечено: ${lines.length} · статус «${statuses[0]}»`
    : `Отмечено: ${lines.length} · статусы: ${statuses.join(', ')}`;
}

/** Переходы, допустимые для ВСЕХ отмеченных строк. */
export function commonTransitions(lines: MarkedLine[]): Transition[] {
  if (lines.length === 0) return [];
  const first = allowedFrom(lines[0]!.status).map((t) => t.to);
  return TRANSITIONS.filter(
    (t) => first.includes(t.to) && lines.every((l) => t.from.includes(l.status as never)),
  );
}

/** Переходы, допустимые лишь для части отмеченных строк — их кнопок не будет. */
export function partialTransitions(lines: MarkedLine[]): { transition: Transition; count: number }[] {
  if (lines.length === 0) return [];
  const common = new Set(commonTransitions(lines).map((t) => t.to));
  return TRANSITIONS.filter((t) => !common.has(t.to))
    .map((t) => ({ transition: t, count: lines.filter((l) => t.from.includes(l.status as never)).length }))
    .filter((x) => x.count > 0);
}

export function actionsPanel(lines: MarkedLine[]): string {
  const common = commonTransitions(lines);
  const partial = partialTransitions(lines);

  const buttons = common
    .map(
      (t) => `<button type="button" data-testid="action-${esc(t.to)}"
        hx-post="/ui/lines/transition" hx-vals='{"to":"${esc(t.to)}"}'
        hx-target="#lines-panel" hx-swap="outerHTML"
        title="Узел ${esc(t.node)}">${esc(t.title)}</button>`,
    )
    .join('\n      ');

  const note = partial.length
    ? `<p class="hint-partial" data-testid="partial-note">Недоступно для части строк: ${partial
        .map((x) => `${esc(x.transition.title)} (${x.count})`)
        .join(', ')}</p>`
    : '';

  return `<div id="actions" data-testid="actions-panel" data-count="${lines.length}">
  <span class="marked-count" data-testid="mark-count">${lines.length}</span>
  <span class="hint" data-testid="actions-hint">${esc(hint(lines))}</span>
  <span class="buttons">
      ${buttons}
  </span>
  ${note}
${chainPanel(lines)}
</div>`;
}
