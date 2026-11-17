import { app } from '../../src/server.ts';
import { encodeSession } from '../../src/session.ts';

// ОБЩИЙ ПОМОЩНИК ДЛЯ ТЕСТОВ: запрос под ролью.
//
// ЗАЧЕМ ОН ПОЯВИЛСЯ. Замер показал: 123 вызова в 44 файлах ходят в приложение БЕЗ СЕССИИ.
// Пока вход не обязателен, это работает; как только закроем — каждый такой вызов получит 401
// и тест упадёт.
//
// Общего помощника не было: каждый файл сам звал `app.request` и сам решал, что передать.
// Поэтому правка касалась бы сорока четырёх файлов. С помощником она касается одного места:
// в тестах меняется `app.request(` на `request(`, и сессия подставляется сама.
//
// ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ — `admin`, И ЭТО НАМЕРЕННО. Администратор видит и может всё, поэтому
// тест, которому роль не важна, получает полный доступ и не падает на правах. Там, где роль
// ВАЖНА, она называется явно — и таких тестов немного, они про права и про закрытые колонки.
//
// ЧЕГО ПОМОЩНИК НЕ ДЕЛАЕТ: он не проверяет закрытость. Тесты, которые ПРОВЕРЯЮТ, что без
// входа не пускают, обязаны звать `app.request` напрямую — иначе проверять будет нечего.

/** Идентификаторы учётных записей: те же, что заводит сид. */
export const USERS: Record<string, string> = {
  admin: '11111111-aaaa-1111-1111-111111111101',
  manager: '11111111-aaaa-1111-1111-111111111102',
  storekeeper: '11111111-aaaa-1111-1111-111111111103',
  mechanic: '11111111-aaaa-1111-1111-111111111104',
  municipality: '11111111-aaaa-1111-1111-111111111105',
};

/** Кука сессии для роли. */
export const cookieOf = (role = 'admin'): string =>
  `arm_session=${encodeSession({ userId: USERS[role] ?? USERS.admin!, role })}`;

/**
 * Запрос под ролью: то же, что `app.request`, но с сессией.
 *
 * Кука подставляется В ЗАГОЛОВКИ, а переданные вызывающим заголовки сохраняются: тест может
 * задать `accept` или свой идентификатор запроса, и помощник их не затирает.
 */
export function request(
  url: string,
  init: RequestInit = {},
  role = 'admin',
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('cookie')) headers.set('cookie', cookieOf(role));
  // `app.request` возвращает `Promise<Response> | Response`; приводим к обещанию, чтобы
  // подпись была честной и вызывающий не думал о двух формах.
  return Promise.resolve(app.request(url, { ...init, headers }));
}

/** Запрос под ролью с ожиданием JSON. */
export async function jsonRequest(
  url: string,
  init: RequestInit = {},
  role = 'admin',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = new Headers(init.headers ?? {});
  headers.set('accept', 'application/json');
  const r = await request(url, { ...init, headers }, role);
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
}

/** Запрос под ролью с ожиданием HTML. */
export async function htmlRequest(
  url: string,
  role = 'admin',
): Promise<{ status: number; body: string }> {
  const r = await request(url, { headers: { accept: 'text/html' } }, role);
  return { status: r.status, body: await r.text() };
}
