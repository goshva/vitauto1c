import { allowedFrom, TRANSITIONS, type Transition } from '../domain/transition.ts';
import { esc } from './html.ts';
import { chainPanel, type MarkedLine } from './chain.ts';
import { stepsPanel } from './steps.ts';

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

  // ДВИЖЕНИЕ ПО ШАГАМ ПРОЦЕССА — вместо переходов по состояниям, когда все отмеченные
  // строки стоят в процессе. Так строка идёт СТРОГО на соседний шаг: у одного состояния
  // бывает несколько шагов, и переход «из нового в новый» перескочил бы шаг, показав, что
  // работа идёт, хотя её не делали.
  //
  // Для строк ВНЕ процесса кнопки шагов не строятся — «следующий шаг» для них не определён,
  // и там работают прежние переходы по состояниям.
  const steps = stepsPanel(lines);

  // Панель шагов отдаётся ВМЕСТО кнопок состояний, а не рядом: два набора кнопок на одно
  // действие оператор читает как выбор и жмёт наугад.
  const buttons = steps !== ''
    ? ''
    : common
      .map(
        (t) => `<button type="button" data-testid="action-${esc(t.to)}"
        hx-post="/ui/lines/transition" hx-vals='{"to":"${esc(t.to)}"}'
        hx-target="#lines-panel" hx-swap="outerHTML"
        title="Узел ${esc(t.node)}">${esc(t.title)}</button>`,
      )
      .join('\n      ');

  // ЧАСТИЧНАЯ ДОСТУПНОСТЬ — ПОВОД ПРЕДЛОЖИТЬ ДЕЙСТВИЕ, А НЕ ТОЛЬКО ПОЖАЛОВАТЬСЯ.
  //
  // Сообщение «Недоступно для части строк» говорит, что переход не общий, и оставляет
  // оператора думать, что с этим делать. Единственное осмысленное действие здесь — снять
  // выделение со всех и отметить заново те строки, к которым переход применим.
  //
  // Поэтому сообщение показывается ВСПЛЫВАЮЩИМ СНИЗУ и несёт кнопку. Оно не в потоке: иначе
  // его появление сдвигало бы строки, а оно появляется и исчезает при каждой отметке.
  const note = partial.length && steps === ''
    ? `<div class="toast" data-testid="partial-note" role="status">
      <span>Недоступно для части строк: ${partial
      .map((x) => `${esc(x.transition.title)} (${x.count})`)
      .join(', ')}</span>
      <button type="button" data-testid="unmark-all"
        hx-post="/ui/lines/unmark" hx-target="#lines-panel" hx-swap="outerHTML">
        Снять выделение со всех</button>
    </div>`
    : '';

  // КНОПКИ ДЕЙСТВИЙ — ТОЖЕ ВНИЗ, К ОТМЕЧЕННЫМ СТРОКАМ.
  //
  // Замер показал: после перевода нижних панелей из потока высота страницы всё равно росла
  // на 36 пикселей. Источник — этот ряд кнопок: он появляется при отметке и остаётся В
  // ПОТОКЕ. То есть прыжок полосы прокрутки давали ТРИ элемента, и починка двух его не
  // убрала.
  //
  // Так решается и по существу: кнопки действуют НА ОТМЕЧЕННЫЕ СТРОКИ, и их место — рядом
  // с ними, в нижней панели, а не в шапке таблицы. Счётчик и подпись остаются в потоке:
  // они одной строки и высоту не меняют.
  // ПАНЕЛЬ ДЕЙСТВИЙ ЦЕПОЧКИ СЧИТАЕТСЯ ОБЯЗАТЕЛЬНОЙ.
  //
  // Она рисуется всегда — при пустой отметке её кнопки просто отключены, — и в условии
  // появления контейнера её надо учитывать. В первой версии я учитывал только кнопки,
  // шаги и замечание: при пустой отметке контейнер не появлялся вовсе, и вместе с ним
  // ПРОПАДАЛИ ссылки на печатные формы. Тест печати на этом и остановился.
  const chain = chainPanel(lines);

  const floating = buttons !== '' || steps !== '' || note !== '' || chain !== ''
    ? `<div class="floating-bottom">
  ${buttons !== '' ? `<div class="chain"><span class="chain-label">Действие:</span>
      <span class="buttons">${buttons}</span></div>` : ''}
  ${steps}
  ${note}
  ${chain}
</div>`
    : '';

  return `<div id="actions" data-testid="actions-panel" data-count="${lines.length}">
  <span class="marked-count" data-testid="mark-count">${lines.length}</span>
  <span class="hint" data-testid="actions-hint">${esc(hint(lines))}</span>
${floating}
</div>`;
}
