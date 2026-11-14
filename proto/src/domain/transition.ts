import { statusTitle, type Status } from './status.ts';

// Переходы процесса. ЕДИНСТВЕННЫЙ источник: в legacy таблица была продублирована
// четырежды (Go-бэкенд, `matrix.json`, `LinesView.vue`, `process.html`), и они разошлись —
// отсюда C21: UI показывал кнопку `reserve` из `partially_ordered`, а бэкенд строку
// молча пропускал («Обработано 0 из 1»).
//
// Здесь таблица одна. Кнопки в HTMX строятся из неё же, поэтому расхождение
// невозможно по построению. `partially_ordered` в набор НЕ входит — так закрывается C21.

export interface Transition {
  /** Код перехода — он же целевой статус. */
  to: Status;
  /** Человеческое название кнопки. */
  title: string;
  /** Узел схемы процесса (для трассировки к ТЗ). */
  node: string;
  /** Из каких статусов переход допустим. */
  from: Status[];
}

export const TRANSITIONS: Transition[] = [
  { to: 'reserve', title: 'Зарезервировать', node: 'M3',
    from: ['new', 'in_work'] },
  { to: 'assembly', title: 'На комплектацию', node: 'M9 · G3',
    from: ['reserve', 'to_stock', 'acceptance', 'ready_to_ship', 'return'] },
  { to: 'ready_to_ship', title: 'Собрано', node: 'K3',
    from: ['assembly'] },
  { to: 'shipped', title: 'Самовывоз', node: 'N4',
    from: ['paid', 'in_transit'] },
  { to: 'acceptance', title: 'Принять по УПД', node: 'K1',
    from: ['shipped'] },
  { to: 'return', title: 'Возврат', node: 'N3 · M16 · K6',
    from: ['shipped', 'ordered', 'paid', 'in_transit', 'to_stock', 'closed'] },
  { to: 'closed', title: 'Закрыть', node: 'M15 · K7 · G9',
    from: ['shipped', 'ready_to_ship', 'return', 'assembly'] },

  // Отказ клиента (ФТ v2 п. 15). Отдельного документа отмены нет: состояние
  // ставится прямо строке — так требует ФТ, и так это было в legacy, где отмена
  // была «просто кнопкой».
  //
  // Два состояния, а не одно: «Отменён» — клиент отказался до выдачи, «Отказался» —
  // при получении. Разница важна складу: в первом случае товар ещё не уехал,
  // во втором он возвращается. Одно состояние скрыло бы это различие.
  { to: 'cancelled', title: 'Отменить', node: 'N2a · M15',
    from: ['new', 'in_work', 'ordered', 'paid', 'in_transit', 'acceptance',
      'to_stock', 'reserve', 'assembly'] },
  { to: 'refused', title: 'Клиент отказался', node: 'N2b',
    from: ['ready_to_ship', 'shipped'] },
];

/** Переходы, допустимые из статуса строки. Из этого списка строятся кнопки. */
export const allowedFrom = (status: string): Transition[] =>
  TRANSITIONS.filter((t) => t.from.includes(status as Status));

/**
 * Проверка допустимости перехода.
 *
 * Возвращает null, если переход можно выполнить, иначе — причину отказа.
 * Причина всегда конкретна: «из «X» нельзя» вместо молчаливого пропуска (C21).
 */
export function checkTransition(to: string, status: string): string | null {
  const t = TRANSITIONS.find((x) => x.to === to);
  if (!t) {
    return `Перехода «${to}» не существует. Допустимые: ${TRANSITIONS.map((x) => x.to).join(', ')}`;
  }
  if (!t.from.includes(status as Status)) {
    const allowed = allowedFrom(status).map((x) => x.title);
    // Название состояния — СЛОВАМИ. Оператор не должен видеть `cancelled`:
    // в списке он видит «Отменён», и отказ обязан называть то же самое.
    return allowed.length
      ? `Из состояния «${statusTitle(status)}» переход «${t.title}» недоступен. Доступно: ${allowed.join(', ')}`
      : `Из состояния «${statusTitle(status)}» переходов нет`;
  }
  return null;
}

/** Особое условие: закрытие отгруженной строки требует отметки «Документ подписан оригинал». */
export const requiresSignedOriginal = (to: string, status: string): boolean =>
  to === 'closed' && status === 'shipped';
