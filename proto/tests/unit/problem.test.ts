import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app } from '../../src/server.ts';

// Гейт §7 задания: «`Problem` — один тип ошибки на всё; `grep 'type Problem'` = 1».
//
// Проверяются две половины гейта:
//   1. определение типа ровно одно (иначе клиент получает разные форматы);
//   2. ОШИБКИ ВАЛИДАЦИИ тоже приходят как Problem. До появления `createApi()`
//      сюда приходило `{"success":false,"error":{"name":"ZodError",…}}` — гейт
//      выглядел выполненным, потому что проверяли только `grep`.

const ROOT = resolve(import.meta.dir, '../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.tmp', 'migrations'].includes(entry.name)) out.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const json = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe('один тип ошибки', () => {
  test('класс Problem определён ровно в одном месте', () => {
    const files = sourceFiles(join(ROOT, 'src'));
    const defining = files.filter((f) => /^export class Problem\b/m.test(readFileSync(f, 'utf8')));
    expect(defining.length, `Problem определён в: ${defining.join(', ')}`).toBe(1);
    expect(defining[0]).toContain('problem.ts');
  });

  test('все под-приложения создаются через createApi (единый обработчик валидации)', () => {
    const files = sourceFiles(join(ROOT, 'src'));
    const raw = files.filter(
      (f) => !f.endsWith('api.ts') && !f.endsWith('server.ts') && /new OpenAPIHono\(\)/.test(readFileSync(f, 'utf8')),
    );
    expect(raw, `мимо createApi: ${raw.join(', ')}`).toEqual([]);
  });
});

describe('ошибка валидации приходит как Problem', () => {
  test('некорректный query — problem+json, а не структура Zod', async () => {
    const { status, body } = await json('/refs/nomenclature?limit=99999');
    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.status).toBe(400);
    expect(typeof body.message).toBe('string');
    expect(body.traceId).toBeTruthy();
    expect(body, 'вернулся формат Zod').not.toHaveProperty('success');
  });

  test('некорректное тело запроса — тоже Problem', async () => {
    const { status, body } = await json('/lines/transition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body).not.toHaveProperty('success');
  });

  test('некорректный путь — Problem с именем поля', async () => {
    const { status, body } = await json('/options/нетакого');
    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(String(body.field)).toContain('kind');
  });

  test('ошибка уровня обработчика остаётся Problem', async () => {
    const { status, body } = await json('/lines/00000000-0000-0000-0000-0000000000ff');
    expect(status).toBe(404);
    expect(body.code).toBe('not_found');
    expect(body).not.toHaveProperty('success');
  });

  test('в любой ошибке есть traceId — он же X-Request-ID', async () => {
    const r = await app.request('/lines/00000000-0000-0000-0000-0000000000ff', {
      headers: { 'x-request-id': 'trace-check-1' },
    });
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.traceId).toBe('trace-check-1');
    expect(r.headers.get('X-Request-ID')).toBe('trace-check-1');
  });
});
