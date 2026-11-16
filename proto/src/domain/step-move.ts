import { processById } from './process-map.ts';

// ПОШАГОВОЕ ДВИЖЕНИЕ ПО ПРОЦЕССУ.
//
// ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ЗАЩИЩАЕТСЯ: строка идёт ПО ШАГАМ СВОЕГО ПРОЦЕССА — на следующий
// или на предыдущий. Не «в любое состояние, которое допускает граф переходов», а строго
// соседний шаг.
//
// ПОЧЕМУ ТАК, А НЕ ПО ГРАФУ СОСТОЯНИЙ. Граф состояний отвечает на вопрос «допустим ли
// переход между состояниями», но у одного состояния бывает НЕСКОЛЬКО шагов: «Новый» стоит
// на шагах 1, 2 и 3 почти каждого процесса. По графу строка могла бы «перейти из нового в
// новый», перескочив шаг, — и учёт показал бы, что работа идёт, хотя её не делали.
//
// Границы: НА ПЕРВОМ ШАГЕ НАЗАД НЕЛЬЗЯ, НА ПОСЛЕДНЕМ ВПЕРЁД НЕЛЬЗЯ. Процесс на этом
// останавливается. Это не ограничение ради ограничения: за последним шагом процесса нет
// следующего состояния, и «продолжить» означало бы выйти за пределы процесса.

/** Шаг процесса: номер, состояние и узлы. */
export interface StepInfo {
  n: number;
  status: string;
  nodes: string[];
  titles: string[];
  /** Последний шаг процесса. */
  isLast: boolean;
  /** Первый шаг процесса. */
  isFirst: boolean;
}

/**
 * Шаг процесса по номеру.
 *
 * СОСТОЯНИЕ ПЕРЕНОСИТСЯ С ПРЕДЫДУЩЕГО ШАГА, если у шага своего нет: шаг без состояния
 * состояние не меняет. Такой шаг в модели один — процесс 10, шаг 16 (узлы G4, G5).
 */
export function stepAt(processId: string, n: number): StepInfo | null {
  const process = processById(processId);
  if (!process) return null;
  if (n < 1 || n > process.steps.length) return null;

  // Идём от начала, перенося состояние: карта хранит `null` там, где шаг его не меняет.
  let carried: string | null = null;
  for (const st of process.steps) {
    carried = st.status ?? carried ?? 'new';
    if (st.n === n) {
      return {
        n,
        status: carried,
        nodes: st.nodes,
        titles: st.titles,
        isFirst: n === 1,
        isLast: n === process.steps.length,
      };
    }
  }
  return null;
}

/** Куда можно сдвинуть строку: соседние шаги. `null` — за границей процесса. */
export interface Neighbours {
  /** Номер текущего шага; `null` — строка не в процессе. */
  at: number | null;
  back: StepInfo | null;
  forward: StepInfo | null;
  /** Сколько всего шагов в процессе. */
  total: number;
}

/**
 * Соседние шаги строки.
 *
 * Если строка ЕЩЁ НЕ В ПРОЦЕССЕ (`processId` пуст), «вперёд» ведёт на первый шаг: так
 * строка входит в процесс. Если процесс неизвестен — соседей нет вовсе, и это надо
 * показать словами, а не пустой панелью.
 */
export function neighbours(processId: string | null, step: number | null): Neighbours {
  if (!processId) return { at: null, back: null, forward: null, total: 0 };

  const process = processById(processId);
  if (!process) return { at: null, back: null, forward: null, total: 0 };

  const total = process.steps.length;
  const at = step ?? 0;

  return {
    at: step,
    // Первый шаг процесса — назад нельзя.
    back: at > 1 ? stepAt(processId, at - 1) : null,
    // Последний шаг — вперёд нельзя, процесс останавливается.
    forward: at < total ? stepAt(processId, at + 1) : null,
    total,
  };
}

/**
 * Проверка: можно ли сдвинуть строку на шаг в заданную сторону.
 *
 * Отдельная функция, потому что её спрашивают ДВА места: панель действий — чтобы решить,
 * рисовать ли кнопку, и обработчик — чтобы не положиться на то, что кнопку нарисовали.
 * Проверка на сервере обязательна: кнопку можно и подделать.
 */
export function canMove(
  processId: string | null, step: number | null, dir: 'next' | 'prev',
): StepInfo | null {
  const nb = neighbours(processId, step);
  return dir === 'next' ? nb.forward : nb.back;
}

