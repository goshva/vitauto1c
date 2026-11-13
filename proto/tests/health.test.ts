import { describe, expect, test } from 'bun:test';
import { app } from '../src/server.ts';

// Гейт этапа 0 (prototype-spec.md §10): /health отвечает ok, и ответ описан схемой.
// Тест написан ДО реализации: сначала падает, потом появляется /health.

describe('GET /health', () => {
  test('отвечает 200 и status=ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('сообщает версию и имя сервиса', async () => {
    const res = await app.request('/health');
    const body = await res.json();

    expect(body.service).toBe('vitauto-proto');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });

  test('сообщает доступность БД отдельным полем, а не падением', async () => {
    const res = await app.request('/health');
    const body = await res.json();

    // db: 'up' | 'down' — health НЕ должен возвращать 500, если БД недоступна:
    // он обязан ответить и сказать правду. Иначе мониторинг не отличит
    // «сервис мёртв» от «сервис жив, БД лежит».
    expect(['up', 'down']).toContain(body.db);
  });

  test('возвращает X-Request-ID в заголовках', async () => {
    const res = await app.request('/health');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  test('принимает входящий X-Request-ID и возвращает его же', async () => {
    const res = await app.request('/health', { headers: { 'x-request-id': 'test-trace-123' } });
    expect(res.headers.get('x-request-id')).toBe('test-trace-123');
  });
});
