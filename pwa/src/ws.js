// ws.js — сигнальный WebSocket-клиент PWA (asyncapi.yaml v0.2.0).
// Сервер шлёт МИНИМАЛЬНЫЕ сигналы, клиент сам перезапрашивает нужный GET:
//   change → батч [{e,id,op}] → entity: line → /lines, return → /returns, work_order → /work-orders,
//            unidentified → /unidentified, access_request → /access-requests
//   notice → перечитать /notifications (событие 'notices' для NotificationsBell)
//   resync → очередь переполнена — полная перезагрузка данных
//   ping   → ответить {"kind":"pong"}
// Только для Go API (baseUrl /api…); в OData-режиме соединение не поднимается.
import { mitt } from './lib/mitt';
import { useSessionStore } from './stores/session';

// Шина событий для компонентов: 'notices' (новое уведомление), 'changed' (списки обновились)
export const wsBus = mitt();

let ws = null;
let timer = null;
let token = null;
let stopped = true;
const RECONNECT_MS = 4000;
const PONG = JSON.stringify({ kind: 'pong' });

// entity → путь эндпоинта, который инвалидируется сигналом (тот же список, что в openapi /ws)
export const ENTITY_ENDPOINT = {
  line: '/lines',
  return: '/returns',
  work_order: '/work-orders',
  unidentified: '/unidentified',
  access_request: '/access-requests'
};

function url() {
  const base = useSessionStore().baseUrl || '/api/v1'; // '/api/v1' → тот же origin, прокси vite/ws
  const path = base.replace(/\/$/, '') + '/ws';
  const abs = new URL(path, window.location.origin);
  abs.protocol = abs.protocol === 'https:' ? 'wss:' : 'ws:';
  abs.searchParams.set('token', token);
  return abs.toString();
}

function open() {
  if (ws || stopped || !token) return;
  try { ws = new WebSocket(url()); } catch { ws = null; }
  if (!ws) return;
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.kind === 'pong') return;
    if (m.kind === 'ping') { if (ws && ws.readyState === 1) ws.send(PONG); return; }
    if (m.kind === 'change') {
      const sigs = Array.isArray(m.payload) ? m.payload : [];
      const eps = new Set();
      for (const s of sigs) if (ENTITY_ENDPOINT[s.e]) eps.add(ENTITY_ENDPOINT[s.e]);
      if (eps.size) wsBus.emit('changed', eps);
      return;
    }
    if (m.kind === 'notice') { wsBus.emit('notices', m.payload || null); return; }
    if (m.kind === 'resync') wsBus.emit('resync');
  };
  ws.onclose = () => {
    ws = null;
    if (!stopped && token) timer = setTimeout(open, RECONNECT_MS);
  };
  ws.onerror = () => { try { ws && ws.close(); } catch { /* onclose переподключит */ } };
}

export function startWs(t) {
  const session = useSessionStore();
  stopped = !/\/api(\/|$)/.test(session.baseUrl || '');
  token = t || null;
  if (stopped || !token) return;
  if (timer) { clearTimeout(timer); timer = null; }
  open();
}

export function stopWs() {
  stopped = true;
  token = null;
  if (timer) { clearTimeout(timer); timer = null; }
  if (ws) { const c = ws; ws = null; c.onclose = null; try { c.close(); } catch { /* уже закрыт */ } }
}
