// Клиент стандартного интерфейса OData 1С: Basic-авторизация пользователем ИБ, JSON, ошибки odata.error -> ApiError.
// Каждый запрос пишется в журнал (экран «Журнал»): метод, адрес, код, время, тело ответа.
import { ApiError } from './errors';

export const EMPTY = '00000000-0000-0000-0000-000000000000';
export const EMPTY_DATE = '0001-01-01T00:00:00';

// «Basic …» из логина и пароля (UTF-8: 1С принимает кириллические имена пользователей)
export function basicToken(login, password) {
  const bytes = new TextEncoder().encode(`${login}:${password}`);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return 'Basic ' + btoa(bin);
}

// Путь набора/записи: кириллица кодируется, а скобки, кавычки, «=», «,», «/» ключа остаются как есть
export function encodePath(path) {
  return path.split('/').map(seg => encodeURIComponent(seg).replace(/%28/g, '(').replace(/%29/g, ')')
    .replace(/%27/g, "'").replace(/%3D/g, '=').replace(/%2C/g, ',').replace(/'/g, "'")).join('/');
}

// Параметры $filter/$select/... : значения кодируются целиком
export function encodeQuery(q) {
  return Object.entries(q || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

// Строковый литерал OData: '…' с удвоением кавычек
export const lit = s => `'${String(s).replace(/'/g, "''")}'`;
export const guid = g => `guid'${g}'`;

// Сбои файловой 1С, после которых тот же запрос в другом сеансе пула проходит
export const TRANSIENT = /Тип не определен|Нельзя сравнивать поля|менеджере имен базы данных|не является значением объектного типа/;

export function createClient({ baseUrl, token, log }) {
  async function request(method, path, { query, body, headers } = {}, retry = 0) {
    const q = encodeQuery({ $format: 'json', ...query });
    const url = baseUrl.replace(/\/$/, '') + '/' + encodePath(path) + (q ? '?' + q : '');
    const h = { Accept: 'application/json', ...headers };
    if (token) h.Authorization = token;
    if (body !== undefined) h['Content-Type'] = 'application/json; charset=utf-8';
    const entry = { at: new Date(), method, url: decodeURIComponent(url.replace(/^https?:\/\/[^/]+/, '')), request: body };
    const t0 = performance.now();
    let res, text;
    try {
      res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
      text = await res.text();
    } catch (e) {
      if (log) log({ ...entry, status: 0, ms: Math.round(performance.now() - t0), response: e.message });
      throw new ApiError(0, { code: 'network', message: 'Нет связи с OData 1С: ' + e.message });
    }
    let data;
    try { data = text ? JSON.parse(text.replace(/^﻿/, '')) : undefined; } catch { data = text; }
    if (log) log({ ...entry, status: res.status, ms: Math.round(performance.now() - t0), response: data });
    // Файловая 1С: сеанс пула OData иногда «теряет» типы расширений (500 «Тип не определен», «внутренняя ошибка
    // OData сервиса» …) — чтение идемпотентно, повторяем его в другом сеансе пула
    if (res.status === 500 && method === 'GET' && retry < 2) {
      return request(method, path, { query, body, headers }, retry + 1);
    }
    if (!res.ok) {
      const msg = data && data['odata.error'] ? data['odata.error'].message.value : (typeof data === 'string' ? data : `HTTP ${res.status}`);
      const code = res.status === 401 ? 'unauthorized' : res.status === 404 ? 'not_found' : res.status === 400 ? 'bad_request' : 'odata_error';
      throw new ApiError(res.status, { code, message: msg });
    }
    return data;
  }
  return {
    request,
    get: (path, query) => request('GET', path, { query }),
    list: async (path, query) => ((await request('GET', path, { query })) || {}).value || [],
    count: async (path, filter) => Number(String(await request('GET', path + '/$count', { query: { $filter: filter, $format: undefined } })).trim()),
    post: (path, body, query) => request('POST', path, { body, query }),
    patch: (path, body) => request('PATCH', path, { body }),
    del: path => request('DELETE', path)
  };
}
