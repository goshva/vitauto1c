// fetch-обёртка для REST API АРМ: токен сессии, JSON, Problem-ответы и журнал запросов.
import { useSessionStore } from './stores/session';
import { useLogStore } from './stores/log';

export class ApiError extends Error {
  constructor(status, problem) {
    super((problem && problem.message) || `HTTP ${status}`);
    this.status = status;
    this.code = (problem && problem.code) || 'http_' + status;
    this.field = problem && problem.field;
    this.problem = problem;
  }
}

export async function api(method, path, { query, body, headers } = {}) {
  const session = useSessionStore();
  const log = useLogStore();
  const url = new URL(session.baseUrl.replace(/\/$/, '') + path, location.origin);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const h = { Accept: 'application/json', ...headers };
  if (session.token) h.Authorization = 'Bearer ' + session.token;
  if (body !== undefined) h['Content-Type'] = 'application/json; charset=utf-8';

  const entry = { at: new Date(), method, url: url.pathname + url.search, request: body };
  const t0 = performance.now();
  let res, text;
  try {
    res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    text = await res.text();
  } catch (e) {
    log.add({ ...entry, status: 0, ms: Math.round(performance.now() - t0), response: e.message });
    throw new ApiError(0, { code: 'network', message: 'Нет связи с API: ' + e.message });
  }
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  log.add({ ...entry, status: res.status, ms: Math.round(performance.now() - t0), response: data });

  if (res.status === 401 && session.token && path !== '/session') session.expire();
  if (!res.ok && res.status !== 304) throw new ApiError(res.status, typeof data === 'object' ? data : { message: String(data || '') });
  return { status: res.status, data, headers: res.headers };
}

export const get = (path, query, opts) => api('GET', path, { ...opts, query }).then(r => r.data);
export const post = (path, body) => api('POST', path, { body }).then(r => r.data);
