import type { Context } from 'hono';
import { z } from 'zod';

// ОДИН тип ошибки на всё API (prototype-spec.md §7: `grep 'type Problem'` = 1).
// В legacy было три разных представления ошибок, и клиент не мог их разобрать единообразно.
//
// Формат совместим с RFC 9457 (problem+json): code, status, message, field, traceId.
// traceId — тот же X-Request-ID, что в ответе и в логе: по нему агент связывает
// ответ, лог и тест.

export const ProblemSchema = z.object({
  code: z.string().min(1).describe('Машинный код: version_conflict, nothing_marked, field_readonly …'),
  status: z.number().int().min(400).max(599),
  message: z.string().min(1).describe('Текст для человека'),
  field: z.string().optional().describe('Поле, из-за которого ошибка'),
  traceId: z.string().optional(),
});

export type ProblemBody = z.infer<typeof ProblemSchema>;

export class Problem extends Error {
  readonly code: string;
  readonly status: number;
  readonly field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = 'Problem';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/**
 * Частые ошибки. Собраны в один объект, а не в четыре отдельные функции:
 * файл обязан держать ≤ 5 экспортов, иначе теряется контекст.
 */
export const problems = {
  badRequest: (message: string, field?: string) => new Problem(400, 'bad_request', message, field),
  notFound: (message: string) => new Problem(404, 'not_found', message),
  conflict: (message: string, code = 'conflict') => new Problem(409, code, message),
  versionConflict: (expected: number, actual: number) =>
    new Problem(409, 'version_conflict',
      `Строку изменили: ожидалась версия ${expected}, в базе ${actual}. ` +
      'Перечитайте строку и повторите — см. prototype-spec.md §7 (If-Match).'),
  nothingMarked: (what = 'строки') =>
    new Problem(409, 'nothing_marked', `Нет отмеченных ${what}. Отметьте строки в списке и повторите.`),
  fieldReadonly: (field: string, allowed: string[]) =>
    new Problem(400, 'field_readonly',
      `Поле «${field}» не редактируется вручную. Редактируемые: ${allowed.join(', ')}`, field),
};

/**
 * Ответ-ошибка с traceId из контекста.
 *
 * Статус приводится к ОБЪЕДИНЕНИЮ статусов, которые Problem действительно может
 * вернуть, а не к литералу `400`, как было раньше. Приведение к `400` **врало
 * о статусе**: тип ответа говорил 400, а в рантайме приходило 404 или 409.
 * Приведение к `StatusCode` — слишком широко: маршрут с объявленным 400 перестаёт
 * компилироваться. Нужен именно перечень: 400, 404, 409, 500.
 *
 * Обе крайности (`as 400` и `as StatusCode`) проверены — обе ломают типизацию.
 */
/**
 * Ответ-ошибка с traceId из контекста.
 *
 * Тип возврата — `never`, и это осознанно. Hono требует, чтобы возвращаемое
 * значение обработчика ТОЧНО совпадало с объединением объявленных ответов
 * маршрута. Статус ошибки динамический (400 / 404 / 409 / 500), поэтому никакое
 * конкретное приведение не подходит:
 *
 *   `as 400`      — маршрут с объявленным 404 не компилируется, и тип ВРЁТ:
 *                   говорит 400, а в рантайме приходит 404;
 *   `as StatusCode` — слишком широко, не компилируется маршрут с объявленным 400;
 *   объединение    — не компилируется маршрут, объявивший только один из статусов.
 *
 * `never` совместим с любым объявленным набором ответов, а фактический статус
 * подставляет `c.json` в рантайме. Все три неудачных варианта проверены —
 * комментарий оставлен, чтобы их не пробовали снова.
 */
export function problemResponse<C extends Context>(c: C, p: Problem): never {
  const body: ProblemBody = {
    code: p.code,
    status: p.status,
    message: p.message,
    ...(p.field ? { field: p.field } : {}),
    traceId: (c.get('requestId') as string | undefined) ?? undefined,
  };
  return c.json(body, p.status as 400) as never;
}
