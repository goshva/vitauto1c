import { app } from '../src/server.ts';
import { encodeSession } from '../src/session.ts';

// КЛИЕНТ МЕСЯЦА: запросы к приложению ОТ ИМЕНИ РОЛИ.
//
// Почему `app.request`, а не сеть: это ТОТ ЖЕ стек — маршруты, валидация Zod,
// проверки прав, журнал, — но без порта и без ожидания. Тесты прототипа ходят так
// же (`tests/helpers/request.ts:40-50`), и это не упрощение: разница только в
// транспорте, а поведение приложения то же.
//
// Кука подписывается тем же ключом, что у приложения: клиент живёт в том же
// процессе. Роль берётся из учётной записи, как у вошедшего человека, — иначе
// «действия сотрудников» были бы подделкой заголовком `X-Role`.

/** Учётные записи из сида пользователей: логин → идентификатор. */
const USERS: Record<string, string> = {
  admin: '11111111-aaaa-1111-1111-111111111101',
  manager: '11111111-aaaa-1111-1111-111111111102',
  storekeeper: '11111111-aaaa-1111-1111-111111111103',
  mechanic: '11111111-aaaa-1111-1111-111111111104',
};

interface CallResult {
  status: number;
  /** Разобранное тело: JSON или текст. */
  body: unknown;
}

interface EconClient {
  call: (role: string, method: string, path: string, body?: unknown) => Promise<CallResult>;
  /** Вставка листа: форма, а не JSON (`src/import-paste.ts:36-44`). */
  form: (role: string, path: string, fields: Record<string, string>) => Promise<CallResult>;
  /** Сколько запросов ушло в приложение: узел и запрос — не одно и то же. */
  stats: { calls: number };
}

const cookieOf = (role: string): string => {
  const userId = USERS[role];
  if (!userId) throw new Error(`нет учётной записи для роли «${role}»`);
  return `arm_session=${encodeSession({ userId, role })}`;
};

const parse = async (r: Response): Promise<CallResult> => {
  const text = await r.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // HTML (HTMX-ответ) остаётся текстом: он нужен только для проверки статуса.
  }
  return { status: r.status, body };
};

export function createClient(): EconClient {
  const stats = { calls: 0 };

  const call = async (
    role: string, method: string, path: string, body?: unknown,
  ): Promise<CallResult> => {
    stats.calls += 1;
    const headers: Record<string, string> = {
      cookie: cookieOf(role),
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await app.request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return parse(r);
  };

  const form = async (
    role: string, path: string, fields: Record<string, string>,
  ): Promise<CallResult> => {
    stats.calls += 1;
    const data = new URLSearchParams(fields);
    const r = await app.request(path, {
      method: 'POST',
      headers: {
        cookie: cookieOf(role),
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
      },
      body: data.toString(),
    });
    return parse(r);
  };

  return { call, form, stats };
}

export type { EconClient, CallResult };
