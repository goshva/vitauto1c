import raw from '../../db/process-map.json' with { type: 'json' };

// Карта процессов: 11 сценариев модели как данные.
//
// Источник — `db/process-map.json`, сгенерированный `scripts/process-map.ts` из
// модели. Приложение читает АРТЕФАКТ, а не JSON репозитория: иначе прототип
// зависел бы от раскладки каталогов за его пределами.
//
// Каждый шаг знает своё СОСТОЯНИЕ СТРОКИ. Именно это связывает схему с данными:
// по шагу видно не «как должно быть», а сколько строк сейчас на нём. Схема,
// оторванная от данных, — картинка.

interface ProcessStep {
  /** Номер шага по порядку. */
  n: number;
  /** Идентификаторы узлов модели (для трассировки к ТЗ). */
  nodes: string[];
  /** Подписи узлов — приложение не должно знать про модель. */
  titles: string[];
  /** Кто выполняет шаг: client, manager, storekeeper, admin, supplier, chief_mechanic. */
  roles: string[];
  note: string;
  /** Состояние строки ПОСЛЕ шага; `null` — шаг состояния не меняет. */
  status: string | null;
}

export interface Process {
  id: string;
  group: string;
  title: string;
  steps: ProcessStep[];
}

interface ProcessMap {
  generated: { scenarios: number; nodes: number };
  statuses: string[];
  scenarios: Process[];
}

const MAP = raw as ProcessMap;

/** Все процессы в порядке модели. */
export const PROCESSES: Process[] = MAP.scenarios;

/** Всего шагов по всем процессам — 121. */
export const TOTAL_STEPS: number = PROCESSES.reduce((sum, p) => sum + p.steps.length, 0);

export const processById = (id: string): Process | undefined =>
  PROCESSES.find((p) => p.id === id);

/** Человеческие названия ролей — из модели приходят машинные коды. */
export const ROLE_TITLES: Record<string, string> = {
  client: 'Клиент',
  manager: 'Менеджер',
  storekeeper: 'Кладовщик',
  admin: 'Администратор',
  supplier: 'Поставщик',
  chief_mechanic: 'Механик',
};
