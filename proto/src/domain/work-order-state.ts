// Состояние заказ-наряда (ремонт, G1–G9).
//
// Путь: G1 «открыт» → «в работе» → G9 «закрыт». Как и у возврата с отгрузкой,
// состояние ДОКУМЕНТА отдельно от статуса его строк: работы и запчасти живут
// в `line` со ссылкой `work_order_id`, и их статус говорит, где ЗАПЧАСТЬ,
// а не где заказ-наряд.
//
// Таблица одна: название для оператора, статус строк и переходы описывают одно
// и то же состояние.

export const WORK_ORDER_STATUSES = ['new', 'in_work', 'closed'] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

interface StateSpec {
  /** Название для оператора. Используется и в сообщениях об ошибках. */
  title: string;
  /** Статус строк-запчастей в этом состоянии. `null` — не менять. */
  lineStatus: string | null;
  next: WorkOrderStatus[];
}

export const WORK_ORDER_STATES: Record<WorkOrderStatus, StateSpec> = {
  // Из «открыт» можно сразу закрыть: пришёл, посмотрели, работы не нужны.
  new: { title: 'Открыт', lineStatus: null, next: ['in_work', 'closed'] },
  in_work: { title: 'В работе', lineStatus: null, next: ['closed'] },
  closed: { title: 'Закрыт', lineStatus: 'closed', next: [] },
};

const titleOf = (status: string): string =>
  WORK_ORDER_STATES[status as WorkOrderStatus]?.title ?? status;

/** Проверка перехода заказ-наряда. Возвращает причину отказа или null. */
export function checkWorkOrderTransition(from: string, to: string): string | null {
  const state = WORK_ORDER_STATES[from as WorkOrderStatus];
  if (!state) return `Неизвестное состояние заказ-наряда «${from}»`;
  if (state.next.includes(to as WorkOrderStatus)) return null;

  return state.next.length === 0
    ? `Заказ-наряд уже закрыт (состояние «${state.title}»)`
    : `Из состояния «${state.title}» нельзя перейти в «${titleOf(to)}». ` +
      `Доступно: ${state.next.map(titleOf).join(', ')}`;
}
