// Состояние отгрузки. Как и у возврата, состояние ДОКУМЕНТА отдельно от статуса строк:
// статус строки говорит, где товар, состояние отгрузки — где документ.
//
// Путь: K5 «создана» → M12 «отгружена» → M15 «закрыта» (документы проверены).
//
// Экспортов три: состояния, проверка перехода и сам тип. Таблица одна, потому что
// название состояния и статус строк в нём относятся к одному и тому же состоянию —
// разложенные по разным константам, они расходились бы при правке одной из них.

export const SHIPMENT_STATUSES = ['new', 'shipped', 'closed'] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

interface StateSpec {
  /** Название для оператора. Используется и в сообщениях об ошибках. */
  title: string;
  /**
   * Статус строк в этом состоянии. `null` — статус НЕ меняется: создание отгрузки
   * только связывает строки, товар в этот момент ещё лежит на складе.
   */
  lineStatus: string | null;
  /** Куда можно перейти. Пустой список — тупик. */
  next: ShipmentStatus[];
}

export const SHIPMENT_STATES: Record<ShipmentStatus, StateSpec> = {
  new: { title: 'Создана', lineStatus: null, next: ['shipped'] },
  shipped: { title: 'Отгружена', lineStatus: 'shipped', next: ['closed'] },
  closed: { title: 'Закрыта', lineStatus: 'closed', next: [] },
};

const titleOf = (status: string): string =>
  SHIPMENT_STATES[status as ShipmentStatus]?.title ?? status;

/** Проверка перехода документа отгрузки. Возвращает причину отказа или null. */
export function checkShipmentTransition(from: string, to: string): string | null {
  const state = SHIPMENT_STATES[from as ShipmentStatus];
  if (!state) return `Неизвестное состояние отгрузки «${from}»`;
  if (state.next.includes(to as ShipmentStatus)) return null;

  return state.next.length === 0
    ? `Отгрузка уже закрыта (состояние «${state.title}»)`
    : `Из состояния «${state.title}» нельзя перейти в «${titleOf(to)}». ` +
      `Доступно: ${state.next.map(titleOf).join(', ')}`;
}
