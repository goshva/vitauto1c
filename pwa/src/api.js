// Вызовы операций АРМ. Основной режим — REST-контракт vitauto-api (Go): /api/v1/lines, /api/v1/matrix, /api/v1/sales/…
// Резервный режим — OData 1С (src/odata/backend.js): используется, если baseUrl не начинается с /api.
// Экраны и хранилища зовут одни и те же пути, режим выбирается по session.baseUrl.
import { useSessionStore } from './stores/session';
import { useLogStore } from './stores/log';
import { createBackend } from './odata/backend';
import { basicToken } from './odata/client';
import { ApiError } from './odata/errors';

export { ApiError };

export const isGoApi = base => /\/api(\/|$)/.test(base || '');

function joinUrl(base, path) {
  const b = (base || '/api/v1').replace(/\/$/, '');
  return b + '/' + String(path).replace(/^\//, '');
}

async function goApi(method, path, { query, body } = {}) {
  const session = useSessionStore();
  const log = useLogStore();
  const add = e => log.add(e);

  // Вход: без токена, JSON-тело, ответ 201 с token/userName/role.
  if (method === 'POST' && path === '/session') {
    const url = joinUrl(session.baseUrl, '/session');
    const t0 = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    add({ method, url, status: res.status, ms: Date.now() - t0, body: data });
    if (!res.ok) throw new ApiError(res.status, data || { code: 'http_' + res.status, message: 'HTTP ' + res.status });
    return { status: res.status, data, headers: res.headers };
  }

  // GET /session и DELETE /session — локально, без обращения к серверу.
  if (path === '/session') {
    if (!session.token) throw new ApiError(401, { code: 'unauthorized', message: 'Нет сессии' });
    if (method === 'DELETE') return { status: 204, data: undefined, headers: new Headers() };
    return { status: 200, data: { ...session.user, token: session.token }, headers: new Headers() };
  }

  if (!session.token) throw new ApiError(401, { code: 'unauthorized', message: 'Нет сессии' });

  const url = new URL(joinUrl(session.baseUrl, path), window.location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, v);

  const headers = { 'Accept': 'application/json', 'Authorization': `Bearer ${session.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const t0 = Date.now();
  const res = await fetch(url.toString(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  add({ method, url: url.toString(), status: res.status, ms: Date.now() - t0, body: data });

  if (res.status === 401 && session.token) session.expire();
  if (!res.ok) throw new ApiError(res.status, data || { code: 'http_' + res.status, message: 'HTTP ' + res.status });
  return { status: res.status, data, headers: res.headers };
}

export async function api(method, path, { query, body } = {}) {
  const session = useSessionStore();
  if (isGoApi(session.baseUrl)) return goApi(method, path, { query, body });

  // Резервный режим: OData 1С (старое поведение без изменений).
  const log = useLogStore();
  const add = e => log.add(e);
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
export const patch = (path, body) => api('PATCH', path, { body }).then(r => r.data);
export const del = path => api('DELETE', path).then(r => r.data);