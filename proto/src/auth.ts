import type { Context } from 'hono';
import { checkAccess, checkRole, type Action } from './domain/access.ts';
import { Problem } from './problem.ts';

// Кто действует и что ему можно (Q7).
//
// РОЛЬ ПРЕДЪЯВЛЯЕТСЯ ЗАГОЛОВКОМ `X-Role`, а не входом с паролем. Это осознанное
// ограничение прототипа: аутентификации ещё нет, и вход с паролем был бы третьей
// сущностью на ровном месте (пользователь, пароль, сессия). Заголовок проверяет
// ГРАНИЦУ ПРАВ — то, что заказчик просил закрыть до приёмки, — и честно не
// притворяется защитой: подделать его тривиально, и это записано в отчёте.
//
// Без заголовка роль — `admin`. Так работают все остальные тесты и демо
// «один админ делает всё за всех» (условие заказчика).

/** Роль действующего лица. */
export const roleOf = (c: Context): string => c.req.header('x-role') ?? 'admin';

/**
 * Проверка права: `null` — можно, иначе `Problem` с причиной.
 *
 * Неизвестная роль — 400 (ошибка ввода, исправляет вызывающий), нехватка права —
 * 403 (роль известна, но этого делать нельзя). Разные коды важны так же, как
 * у переходов состояния.
 */
export function guard(c: Context, action: Action): Problem | null {
  const role = roleOf(c);

  const unknown = checkRole(role);
  if (unknown) return new Problem(400, 'bad_role', unknown, 'X-Role');

  const denial = checkAccess(role, action);
  if (denial) return new Problem(403, 'forbidden', denial);

  return null;
}
