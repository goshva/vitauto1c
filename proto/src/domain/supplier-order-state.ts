// Состояние заказа поставщику.
//
// Путь P1: черновик → подтверждён → получен. Плюс отмена — процесс
// «Отмена заказа у поставщика» был отдельным сценарием, но выражался одной кнопкой.
//
// Как и у прочих документов, состояние ДОКУМЕНТА отдельно от статуса строк:
// строка говорит, где товар, заказ — где договорённость с поставщиком.
//
// Таблица одна: название, статус строк и переходы описывают одно состояние.

export const SUPPLIER_ORDER_STATUSES = ['new', 'confirmed', 'received', 'cancelled'] as const;

export type SupplierOrderStatus = (typeof SUPPLIER_ORDER_STATUSES)[number];

interface StateSpec {
  /** Название для оператора. Используется и в сообщениях об ошибках. */
  title: string;
  /**
   * Статус строк заказа. `null` — не менять.
   *
   * При отмене строки возвращаются в «Новый»: закупку можно начать заново.
   * При получении — в «На склад»: товар едет на склад, размещение отдельным шагом.
   */
  lineStatus: string | null;
  next: SupplierOrderStatus[];
}

export const SUPPLIER_ORDER_STATES: Record<SupplierOrderStatus, StateSpec> = {
  new: { title: 'Черновик', lineStatus: null, next: ['confirmed', 'cancelled'] },
  confirmed: { title: 'Подтверждён', lineStatus: null, next: ['received', 'cancelled'] },
  received: { title: 'Получен', lineStatus: 'to_stock', next: [] },
  cancelled: { title: 'Отменён', lineStatus: 'new', next: [] },
};

const titleOf = (status: string): string =>
  SUPPLIER_ORDER_STATES[status as SupplierOrderStatus]?.title ?? status;

/** Проверка перехода заказа поставщику. Возвращает причину отказа или null. */
export function checkSupplierOrderTransition(from: string, to: string): string | null {
  const state = SUPPLIER_ORDER_STATES[from as SupplierOrderStatus];
  if (!state) return `Неизвестное состояние заказа поставщику «${from}»`;
  if (state.next.includes(to as SupplierOrderStatus)) return null;

  return state.next.length === 0
    ? `Заказ поставщику уже в состоянии «${state.title}» — переходов нет`
    : `Из состояния «${state.title}» нельзя перейти в «${titleOf(to)}». ` +
      `Доступно: ${state.next.map(titleOf).join(', ')}`;
}
