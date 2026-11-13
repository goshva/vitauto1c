// Статусы строки. Вынесены из `transition.ts`, чтобы каждый файл держал
// не больше пяти экспортов (prototype-spec.md §12).
//
// Человекочитаемые названия живут здесь, а не в представлении: это часть
// предметной области, а не оформления. Раньше они были в двух местах — в Go
// и в `matrix.json`, — и расходились.

export const STATUSES = [
  'new', 'in_work', 'partially_ordered', 'ordered', 'paid', 'in_transit',
  'acceptance', 'to_stock', 'reserve', 'assembly', 'ready_to_ship',
  'shipped', 'return', 'closed',
] as const;

export type Status = (typeof STATUSES)[number];

/** Названия для оператора. Оператор не должен видеть `ready_to_ship`. */
export const STATUS_TITLES: Record<string, string> = {
  new: 'Новый',
  in_work: 'В работе',
  partially_ordered: 'Частично заказан',
  ordered: 'Заказан',
  paid: 'Оплачен',
  in_transit: 'В пути',
  acceptance: 'Приёмка',
  to_stock: 'На склад',
  reserve: 'Резерв',
  assembly: 'Комплектация',
  ready_to_ship: 'Собрано',
  shipped: 'Отгружен',
  return: 'Возврат',
  closed: 'Закрыт',
};

export const statusTitle = (s: string): string => STATUS_TITLES[s] ?? s;

export const isStatus = (s: string): s is Status => (STATUSES as readonly string[]).includes(s);
