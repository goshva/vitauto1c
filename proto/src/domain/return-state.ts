// Состояние возврата. Вынесено в домен, потому что им пользуются два модуля API
// (оформление и переходы) и, возможно, экран.
//
// Три вида возврата — это ТРИ процесса модели, которые в legacy были одной формой
// с разными кнопками:
//   client   — «Возврат от клиента» (N3 → K6 → M19 → M16 → K6 → P3)
//   supplier — «Возврат поставщику (от менеджера)» (M16)
//   internal — «Отказ клиента при получении товара» (N2a)
//
// Состояние возврата ОТДЕЛЬНО от статуса строки: статус строки говорит, где товар,
// а состояние возврата — где документ. Их смешение дало бы «товар на складе,
// а возврат ещё не принят».
//
// Экспортов четыре, а не восемь: название состояния, статус строки и допустимые
// переходы описывают ОДНО И ТО ЖЕ состояние, поэтому лежат в одной таблице.
// Разложенные по трём константам, они расходились при правке одной из них.

export const RETURN_KINDS = ['client', 'supplier', 'internal'] as const;
export const RETURN_STATUSES = ['new', 'accepted', 'to_supplier', 'closed'] as const;

export type ReturnStatus = (typeof RETURN_STATUSES)[number];

interface StateSpec {
  /** Название для оператора. Используется и в сообщениях об ошибках: оператор
   *  не должен видеть «нельзя перейти в to_supplier». */
  title: string;
  /** Статус строк возврата в этом состоянии: где товар, а не где документ. */
  lineStatus: string;
  /** Куда можно перейти. Пустой список — тупик (закрытый возврат). */
  next: ReturnStatus[];
}

export const RETURN_STATES: Record<ReturnStatus, StateSpec> = {
  new: { title: 'Оформлен', lineStatus: 'return', next: ['accepted'] },
  accepted: { title: 'Принят на склад', lineStatus: 'to_stock', next: ['to_supplier', 'closed'] },
  to_supplier: { title: 'Передан поставщику', lineStatus: 'return', next: ['closed'] },
  closed: { title: 'Закрыт', lineStatus: 'closed', next: [] },
};

const titleOf = (status: string): string =>
  RETURN_STATES[status as ReturnStatus]?.title ?? status;
/** Проверка перехода документа возврата. Возвращает причину отказа или null. */
export function checkReturnTransition(from: string, to: string): string | null {
  const state = RETURN_STATES[from as ReturnStatus];
  if (!state) return `Неизвестное состояние возврата «${from}»`;

  if (state.next.includes(to as ReturnStatus)) return null;

  return state.next.length === 0
    ? `Возврат уже закрыт (состояние «${state.title}»)`
    : `Из состояния «${state.title}» нельзя перейти в «${titleOf(to)}». ` +
      `Доступно: ${state.next.map(titleOf).join(', ')}`;
}
