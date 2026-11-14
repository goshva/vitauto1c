// Права ролей (Q7): пять ролей и закрытый список действий.
//
// Роль — это ПРАВО, а не человек: `mechanic` может выполнять работы, а подпись
// в акте ставит конкретный сотрудник (`employee.can_sign`). Здесь только права.
//
// ПОЧЕМУ действия, а не «роль видит экран»: одна и та же роль открывает список
// и НЕ может закрыть наряд. Проверять по «роль X не ходит на адрес Y» значило бы
// запрещать экран целиком, а нужно запрещать ОПЕРАЦИЮ.

export type Role = 'admin' | 'municipality' | 'manager' | 'mechanic' | 'storekeeper';

export type Action =
  | 'dashboard.view'
  | 'request.create'
  | 'request.view'
  | 'work.execute'
  | 'stock.issue'
  | 'fleet.edit'
  | 'invoice.manage'
  /** Удаление документов и строк (ФТ v2 п. 15). */
  | 'data.delete'
  /**
   * Новая закупка (ФТ v2 п. 16). Решение заказчика (14.11.2026): «право вшито в
   * роль менеджера и администратора». Кладовщик закупку не делает — он принимает
   * то, что пришло, и цены закупки ему закрыты (п. 5).
   */
  | 'purchase.create';

/**
 * Кто что может.
 *
 * `admin` есть везде: условие заказчика — «на старте один админ делает всё за всех».
 * Это не ослабление модели, а её текущее состояние: роли вводятся постепенно,
 * и админ остаётся тем, кто закрывает пробелы.
 */
const ALLOWED: Record<Action, Role[]> = {
  'dashboard.view': ['admin'],
  'request.create': ['municipality', 'manager', 'admin'],
  'request.view': ['municipality', 'manager', 'mechanic', 'storekeeper', 'admin'],
  // Работу выполняет механик. Менеджер и заказчик этого не делают — иначе
  // «выработка механиков» перестаёт что-либо значить.
  'work.execute': ['mechanic', 'admin'],
  'stock.issue': ['storekeeper', 'admin'],
  'fleet.edit': ['manager', 'admin'],
  'invoice.manage': ['manager', 'admin'],
  // Удаление — администратор И МЕНЕДЖЕР (решение заказчика, 14.11.2026).
  //
  // ФТ v2 п. 15 говорит «право „Удаление“ снято для всех профилей КРОМЕ
  // администратора», и первая версия закрыла его до одного админа. Заказчик
  // уточнил: удалять может и менеджер. Кладовщик, механик и муниципалитет — нет.
  //
  // Право намеренно УЖЕ права на правку: менеджер и так правит документы, а
  // удаление — отдельное решение, и оно осталось узким.
  'data.delete': ['admin', 'manager'],
  // Закупка — менеджер и администратор (решение заказчика 14.11.2026).
  'purchase.create': ['manager', 'admin'],
};

const ALL_ROLES: Role[] = ['admin', 'municipality', 'manager', 'mechanic', 'storekeeper'];

/** Роль существует? Сообщение об ошибке перечисляет допустимые — как везде. */
export function checkRole(role: string): string | null {
  if (ALL_ROLES.includes(role as Role)) return null;
  return `Роль «${role}» неизвестна. Допустимые: ${ALL_ROLES.join(', ')}.`;
}

export const isAllowed = (role: string, action: Action): boolean =>
  ALLOWED[action].includes(role as Role);

/**
 * Проверка права.
 *
 * Возвращается ПРИЧИНА отказа или `null` — так же, как у переходов состояния.
 * Отказ перечисляет, у КОГО есть право: иначе оператор не знает, к кому идти,
 * и запрет превращается в «кнопка не работает».
 */
export function checkAccess(role: string, action: Action): string | null {
  const roleProblem = checkRole(role);
  if (roleProblem) return roleProblem;
  if (isAllowed(role, action)) return null;

  return `Роль «${role}» не может выполнить действие «${action}». Это доступно: ${ALLOWED[action].join(', ')}.`;
}
