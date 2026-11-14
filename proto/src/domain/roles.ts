// Роли системы (Q7): пять ролей, по которым разграничивается доступ.
//
// Роль — это ПРАВО, а не человек: `mechanic` видит заказ-наряды, а подпись в акте
// ставит конкретный сотрудник (`employee`). Разделение важно потому, что у одного
// сотрудника роль одна, а подписывать акт могут не все — за это отвечает
// `employee.can_sign`.

export type Role = 'admin' | 'municipality' | 'manager' | 'mechanic' | 'storekeeper';

interface RoleSpec {
  title: string;
  /** Что роль делает — для экрана и для отчёта о правах. */
  duty: string;
  /** Главный экран роли: с него начинается работа. */
  home: string;
}

export const ROLES: Record<Role, RoleSpec> = {
  admin: {
    title: 'Администратор',
    duty: 'Делает всё: справочники, пользователи, приёмка тендера, акт',
    home: '/',
  },
  municipality: {
    title: 'Муниципалитет',
    duty: 'Создаёт тендер на ремонт или обслуживание',
    home: '/tenders',
  },
  manager: {
    title: 'Менеджер',
    duty: 'Обрабатывает заявки, резервирует и заказывает запчасти',
    home: '/requests',
  },
  mechanic: {
    title: 'Механик',
    duty: 'Выполняет работы и закрывает заказ-наряд',
    home: '/work-orders',
  },
  storekeeper: {
    title: 'Кладовщик',
    duty: 'Принимает, размещает, выдаёт и списывает запчасти',
    home: '/stock',
  },
};

/** Название роли для оператора. Неизвестная отдаётся как есть, не пустой строкой. */
export const roleTitle = (role: string): string => ROLES[role as Role]?.title ?? role;

/** Список ролей для сообщений об отказе: «Допустимые: admin, manager, …». */
export const roleList = (): string => Object.keys(ROLES).join(', ');

/**
 * Может ли роль выполнять работу механика.
 *
 * Роль `admin` тоже может: администратор делает всё за всех, пока роли не
 * разделены (условие заказчика). Но подпись в акте всё равно требует
 * `employee.can_sign` — это отдельный признак, а не следствие роли.
 */
export const canExecuteWork = (role: string): boolean =>
  role === 'mechanic' || role === 'admin';
