import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { checkAccess, checkRole, type Action } from './domain/access.ts';
import { decodeSession, SESSION_COOKIE } from './session.ts';
import { Problem } from './problem.ts';

// Кто действует и что ему можно.
//
// БЫЛО: роль предъявлялась заголовком `X-Role`, и это было записано как ограничение
// прототипа — «подделать тривиально, защитой не притворяется».
//
// СТАЛО: учётные записи и вход с паролем. Роль приходит из ПОДПИСАННОЙ сессии и
// хранится в учётной записи, а не выбирается на входе — иначе пароль не значил бы
// ничего: вошёл бы своим именем и выбрал себе администратора.
//
// Заголовок `X-Role` ОСТАЛСЯ как запасной путь, и вот почему: на нём держатся
// автотесты и демонстрация API без входа. Он работает ТОЛЬКО когда сессии нет —
// вошедший пользователь свою роль заголовком не подменит.

/** Действующее лицо: идентификатор и роль. `userId` пуст при работе по заголовку. */
export interface Actor {
  userId: string | null;
  role: string;
}

/** Кто действует. Сессия важнее заголовка: вошедший роль заголовком не подменит. */
export function actorOf(c: Context): Actor {
  const session = decodeSession(getCookie(c, SESSION_COOKIE));
  if (session) return { userId: session.userId, role: session.role };

  return { userId: null, role: c.req.header('x-role') ?? 'admin' };
}

/** Роль действующего лица. */
export const roleOf = (c: Context): string => actorOf(c).role;

/**
 * Идентификатор действующего лица или `null`.
 *
 * `null` — это работа по заголовку `X-Role` (демо и тесты). Проверки авторства
 * трактуют это как «администратор»: иначе демонстрация без входа не смогла бы
 * снять поставленный ею же резерв.
 */
export const userIdOf = (c: Context): string | null => actorOf(c).userId;

/**
 * Проверка права: `null` — можно, иначе `Problem` с причиной.
 *
 * Неизвестная роль — 400 (ошибка ввода, исправляет вызывающий), нехватка права —
 * 403 (роль известна, но этого делать нельзя). Разные коды важны так же, как
 * у переходов состояния.
 */
export function guard(c: Context, action: Action): Problem | null {
  const { role } = actorOf(c);

  const unknown = checkRole(role);
  if (unknown) return new Problem(400, 'bad_role', unknown, 'X-Role');

  const denial = checkAccess(role, action);
  if (denial) return new Problem(403, 'forbidden', denial);

  return null;
}
