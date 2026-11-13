import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 4: один экран на четыре вида документов.
//
// Проверяется главное: кнопки на экране — ТЕ ЖЕ переходы, что разрешает API.
// Экран не выполняет переход сам, а делегирует в API, поэтому вторая реализация
// не появляется и разойтись с первой не может.

const RETURN_LINE = 'b0000000-0000-0000-0000-000000000008';

const html = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, { ...init, headers: { accept: 'text/html', ...(init?.headers ?? {}) } });
  return { status: r.status, body: await r.text() };
};

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('return');
});

describe('экран документов', () => {
  test('все четыре вида открываются с вкладками', async () => {
    for (const kind of ['returns', 'shipments', 'supplier-orders', 'work-orders']) {
      const { status, body } = await html(`/documents/${kind}`);
      expect(status, `${kind}: не открылся`).toBe(200);
      expect(body).toContain(`data-testid="page-documents-${kind}"`);
      expect(body).toContain('data-testid="doc-tabs"');
    }
  });

  test('неизвестный вид → 404 без падения', async () => {
    const { status } = await html('/documents/нетакого');
    expect(status).toBe(404);
  });

  test('пустой список объясняется словами, а не пустой таблицей', async () => {
    const { body } = await html('/documents/returns');
    expect(body).toContain('data-testid="documents-empty"');
    expect(body).not.toContain('data-testid="documents-table"');
  });

  test('навигация ведёт на документы', async () => {
    const { body } = await html('/lines');
    expect(body).toContain('data-testid="nav-documents"');
    expect(body).toContain('href="/documents/returns"');
  });
});

describe('документ на экране и его действия', () => {
  /** Оформляет возврат по отмеченной строке и возвращает его id из списка. */
  async function makeReturn(): Promise<string> {
    await app.request(`/lines/${RETURN_LINE}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: true }),
    });
    const r = await app.request('/returns', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'client' }),
    });
    return String(((await r.json()) as { id: string }).id);
  }

  test('оформленный возврат виден со своим состоянием на языке оператора', async () => {
    const id = await makeReturn();
    const { body } = await html('/documents/returns');

    expect(body).toContain(`data-testid="doc-${id}"`);
    expect(body).toContain(`data-testid="doc-status-${id}"`);
    expect(body).toContain('Оформлен');
    expect(body).not.toContain('>new<');
  });

  test('на экране только допустимые переходы', async () => {
    const id = await makeReturn();
    const { body } = await html('/documents/returns');

    // Из «Оформлен» доступно только «Принят на склад».
    expect(body).toContain(`data-testid="doc-action-${id}-accepted"`);
    expect(body, 'недоступный переход показан').not.toContain(`data-testid="doc-action-${id}-closed"`);
  });

  test('действие делегирует в API: состояние меняется', async () => {
    const id = await makeReturn();

    const { status, body } = await html(`/ui/documents/returns/${id}/accepted`, { method: 'POST' });
    expect(status).toBe(200);
    expect(body).toContain('Принят на склад');

    // И в базе тоже — экран не просто перерисовался.
    const r = await pool.query<{ s: string }>(`select status s from return_order where id = $1`, [id]);
    expect(r.rows[0]!.s).toBe('accepted');
  });

  test('недоступный переход показывает причину, а не глотает её', async () => {
    const id = await makeReturn();
    // Из «Оформлен» в «Закрыт» напрямую нельзя.
    const { body } = await html(`/ui/documents/returns/${id}/closed`, { method: 'POST' });

    expect(body).toContain('data-testid="document-error"');
    expect(body).toContain('Оформлен');

    const r = await pool.query<{ s: string }>(`select status s from return_order where id = $1`, [id]);
    expect(r.rows[0]!.s, 'состояние изменилось, хотя переход запрещён').toBe('new');
  });

  test('после действия набор кнопок пересчитан', async () => {
    const id = await makeReturn();
    const { body } = await html(`/ui/documents/returns/${id}/accepted`, { method: 'POST' });

    expect(body, 'кнопка пройденного перехода осталась').not.toContain(`data-testid="doc-action-${id}-accepted"`);
    expect(body).toContain(`data-testid="doc-action-${id}-to_supplier"`);
  });

  test('отгрузка проходит через тот же экран', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [RETURN_LINE]);
    await app.request(`/lines/${RETURN_LINE}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: true }),
    });
    const created = await app.request('/shipments', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    const id = String(((await created.json()) as { id: string }).id);

    const list = await html('/documents/shipments');
    expect(list.body).toContain('Создана');
    expect(list.body).toContain(`data-testid="doc-action-${id}-shipped"`);

    const done = await html(`/ui/documents/shipments/${id}/shipped`, { method: 'POST' });
    expect(done.body).toContain('Отгружена');
  });
});
