// Вызовы операций АРМ (контракт REST API: /lines, /matrix, /sales/…) — выполняются через стандартный интерфейс
// OData 1С (src/odata/backend.js). Экраны и хранилища зовут те же пути, что и при HTTP-сервисе Арм_API.
// Журнал запросов (экран «Журнал») — реальные запросы OData: метод, адрес, код, время, тело ответа.
import { useSessionStore } from './stores/session';
import { useLogStore } from './stores/log';
import { createBackend } from './odata/backend';
import { basicToken } from './odata/client';
import { ApiError } from './odata/errors';

export { ApiError };

export async function api(method, path, { query, body } = {}) {
  const session = useSessionStore();
  const log = useLogStore();
  const add = e => log.add(e);
  // вход: токен — Basic-авторизация пользователя ИБ; проверяется первым же запросом OData
  if (method === 'POST' && path === '/session') {
    const token = basicToken((body && body.login) || '', (body && body.password) || '');
    const backend = createBackend({ baseUrl: session.baseUrl, session: { token, user: null }, log: add });
    const user = await backend(method, path, { body });
    return { status: 201, data: { ...user.data, token }, headers: new Headers() };
  }
  if (path === '/session') {
    if (!session.token) throw new ApiError(401, { code: 'unauthorized', message: 'Нет сессии' });
    if (method === 'DELETE') return { status: 204, data: undefined, headers: new Headers() };
    return { status: 200, data: { ...session.user, token: session.token }, headers: new Headers() };
  }
  if (!session.token) throw new ApiError(401, { code: 'unauthorized', message: 'Нет сессии' });
  const backend = createBackend({ baseUrl: session.baseUrl, session, log: add });
  try {
    return await backend(method, path, { query: query || {}, body });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && session.token) session.expire();
    if (e instanceof ApiError) throw e;
    throw new ApiError(500, { code: 'client_error', message: e.message });
  }
}

export const get = (path, query, opts) => api('GET', path, { ...opts, query }).then(r => r.data);
export const post = (path, body) => api('POST', path, { body }).then(r => r.data);
