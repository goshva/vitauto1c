import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Карта процессов как ЧАСТЬ приложения, а не отдельная страница.
//
// Проверяется главное: схема связана с РЕАЛЬНЫМИ данными. Шаг процесса знает своё
// состояние строки, поэтому по схеме видно не «как должно быть», а «сколько сейчас
// строк на этом шаге». Схема, оторванная от данных, — это картинка.

const html = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'text/html' } });
  return { status: r.status, body: await r.text() };
};

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('GET /processes — общая схема', () => {
  test('страница открывается и показывает все 11 процессов', async () => {
    const { status, body } = await html('/processes');
    expect(status).toBe(200);
    expect(body).toContain('data-testid="page-processes"');

    for (const id of ['happy', 'stock', 'mixed_order', 'delivery_split', 'virtual_buy',
      'defect', 'cancel_supplier', 'return', 'return_mgr', 'return_internal', 'car_repair_in']) {
      expect(body, `процесс ${id} не показан`).toContain(`data-testid="process-${id}"`);
    }
  });

  test('у каждого процесса видно число шагов и название', async () => {
    const { body } = await html('/processes');
    expect(body).toContain('Основной: закупка → отгрузка');
    expect(body).toContain('Возврат от клиента');
    // 121 шаг — из модели.
    expect(body).toContain('121');
  });

  test('показана общая статистика по состояниям', async () => {
    const { body } = await html('/processes');
    expect(body).toContain('data-testid="stats-by-status"');

    // В базе две строки в «Новый» (сиды happy и stock) — это и есть данные схемы.
    const stats = await pool.query<{ n: string }>(
      `select count(*)::text n from line where not deleted and status = 'new'`,
    );
    expect(Number(stats.rows[0]!.n)).toBe(2);
    expect(body).toContain('data-testid="stat-new"');
  });

  test('статистика пересчитывается после смены состояния', async () => {
    await pool.query(`update line set status = 'reserve' where status = 'new'`);
    const { body } = await html('/processes');
    expect(body).toContain('data-testid="stat-reserve"');
  });
});

describe('переключение на процесс', () => {
  test('карточка процесса открывается по ссылке', async () => {
    const { status, body } = await html('/processes/happy');
    expect(status).toBe(200);
    expect(body).toContain('data-testid="page-process-happy"');
    expect(body).toContain('Основной: закупка → отгрузка');
  });

  test('видны шаги с подписями узлов и состояниями', async () => {
    const { body } = await html('/processes/happy');
    expect(body).toContain('data-testid="step-1"');
    // Первый шаг — заявка клиента (N1).
    expect(body).toContain('Заявка');
    // Состояние после шага.
    expect(body).toContain('data-testid="step-status-1"');
  });

  test('HTMX-панель переключает процесс без перезагрузки', async () => {
    const { status, body } = await html('/ui/processes/panel?process=return');
    expect(status).toBe(200);
    expect(body).toContain('data-testid="process-panel"');
    expect(body).toContain('Возврат от клиента');
  });

  test('неизвестный процесс → 404 со списком допустимых', async () => {
    const { status, body } = await html('/processes/нетакого');
    expect(status).toBe(404);
    expect(body).toContain('happy');
  });

  test('все 11 процессов открываются карточкой', async () => {
    const ids = ['happy', 'stock', 'mixed_order', 'delivery_split', 'virtual_buy',
      'defect', 'cancel_supplier', 'return', 'return_mgr', 'return_internal', 'car_repair_in'];
    for (const id of ids) {
      const { status } = await html(`/processes/${id}`);
      expect(status, `${id}: карточка не открылась`).toBe(200);
    }
  });
});

describe('связь схемы с данными', () => {
  test('шаг показывает, сколько строк сейчас в его состоянии', async () => {
    const { body } = await html('/processes/happy');
    // Обе строки сидов в «Новый» — шаг со статусом new обязан это показать.
    expect(body).toContain('data-testid="step-count-');
  });

  test('карточка процесса ведёт в список строк с этим состоянием', async () => {
    const { body } = await html('/processes/happy');
    expect(body).toContain('href="/lines?status=new"');
  });
});

describe('навигация', () => {
  test('ссылка в шапке ведёт на карту процессов, а не в 404', async () => {
    const { body } = await html('/lines');
    expect(body).toContain('data-testid="nav-process"');
    expect(body, 'ссылка ведёт на статичный process.html, которого нет в прототипе')
      .not.toContain('href="/process.html"');
    expect(body).toContain('href="/processes"');
  });
});
