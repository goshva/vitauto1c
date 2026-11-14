import { createHmac, timingSafeEqual } from 'node:crypto';

// Сессия: кто вошёл и в какой роли.
//
// РЕШЕНИЕ: роль и идентификатор едут В ПОДПИСАННОЙ КУКЕ, без обращения к базе на
// каждом запросе. Плата известна и записана: если роль в учётной записи поменяют,
// вошедший останется в прежней до повторного входа. Для прототипа это приемлемо, а
// запрос в базу на каждый запрос списка — нет.
//
// Подпись обязательна. Без неё куку можно переписать руками и стать администратором:
// тогда весь смысл учётных записей пропадает, и мы вернулись бы к заголовку `X-Role`,
// только с иллюзией защиты.

const COOKIE = 'arm_session';

/**
 * Ключ подписи. Берётся из окружения; если не задан — генерируется на запуск.
 *
 * Сгенерированный ключ означает, что после перезапуска сервера все сессии
 * разлогинятся. Это ЧЕСТНЕЕ, чем вшитый в код ключ-по-умолчанию: такой ключ
 * выглядит защитой, но известен каждому, кто читал исходники.
 */
export const SESSION_SECRET: string =
  process.env.SESSION_SECRET ?? crypto.randomUUID() + crypto.randomUUID();

export const SESSION_COOKIE = COOKIE;

export interface Session {
  userId: string;
  role: string;
}

const sign = (payload: string): string =>
  createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');

/** Подписывает сессию в значение куки. */
export function encodeSession(s: Session): string {
  const payload = `${s.userId}:${s.role}`;
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload)}`;
}

/**
 * Разбирает куку. Возвращает `null` на любой непонятности: битая кука — это
 * «не вошёл», а не ошибка сервера.
 */
export function decodeSession(raw: string | undefined): Session | null {
  if (!raw) return null;

  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = sign(payload);
  // Сравнение с постоянным временем: обычное `===` на подписи — это подсказка
  // атакующему о том, сколько байт он угадал.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const sep = payload.indexOf(':');
  if (sep <= 0) return null;

  return { userId: payload.slice(0, sep), role: payload.slice(sep + 1) };
}
