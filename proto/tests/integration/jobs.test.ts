import { beforeEach, describe, expect, test } from 'bun:test';
import { request } from '../helpers/request.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { encodeSession } from '../../src/session.ts';
import { jobStates, runJob, dueJobs } from '../../src/jobs-run.ts';
import { tick } from '../../src/scheduler.ts';
import { JOBS } from '../../src/jobs.ts';

// Регламентные задания: то, что должно происходить само.
//
// ГЛАВНОЕ ЗДЕСЬ — НЕ «ЗАДАНИЕ ЗАПУСКАЕТСЯ», А «НЕЗАПУСТИВШЕЕСЯ ВИДНО» ровно в тех
// случаях, ради которых задания и заведены:
//   · задание не запускалось ни разу — это не «всё хорошо», это «не работает»;
//   · задание молчит дольше срока — это ттревогаевога, а не строка списка;
//   · задание падает раз за разом — это видно по счётчику, а не по одной записи.
//
// Планировщик, тихо переставший работать, выглядит как работающий. Поэтому проверки
// смотрят не на факт пуска, а на состояние: «прошло ли больше положенного».

const admin = '11111111-aaaa-1111-1111-111111111101';
const manager = '11111111-aaaa-1111-1111-111111111102';
const asAdmin = `arm_session=${encodeSession({ userId: admin, role: 'admin' })}`;
const asManager = `arm_session=${encodeSession({ userId: manager, role: 'manager' })}`;

const html = async (url: string, cookie = '') => {
  const r = await request(url, {
    headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) },
  });
  return { status: r.status, body: await r.text() };
};
const uiPost = (url: string, cookie = '') =>
  request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: '',
  });

/** «Как будто задание запускалось столько-то часов назад». */
async function pretendRan(name: string, hoursAgo: number): Promise<void> {
  const def = JOBS.find((j) => j.name === name)!;
  await pool.query(
    `insert into scheduled_job (name, title, schedule, every_hours, last_run_at,
                                last_status, failed_streak, enabled)
     values ($1, $2, $3, $4, now() - make_interval(hours => $5), 'ok', 0, 1)
     on conflict (name) do update
       set last_run_at = now() - make_interval(hours => $5), last_status = 'ok',
           failed_streak = 0, enabled = 1`,
    [name, def.title, def.schedule, def.everyHours, hoursAgo],
  );
}

const runRows = async (name: string) =>
  (await pool.query<{ status: string; message: string | null; duration_ms: number | null }>(
    `select status, message, duration_ms from scheduled_job_run
      where name = $1 order by started_at desc`, [name])).rows;

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
  await pool.query(`delete from scheduled_job_run`);
  await pool.query(`delete from scheduled_job`);
});

describe('задания · состояние и просрочка', () => {
  test('ни разу не запускавшееся — это «пора», а не «всё хорошо»', async () => {
    const states = await jobStates();
    expect(states.length).toBe(JOBS.length);

    for (const s of states) {
      expect(s.lastRunAt, `${s.name}: не запускалось, а считается, что запускалось`)
        .toBe(null);
      expect(s.due, `${s.name}: не запускалось, но не пора`).toBe(true);
      // Отдельно от `due`: «пора» и «просрочено» — разные вещи. Первый пуск после
      // установки не должен выглядеть тревогой.
      expect(s.overdue, `${s.name}: первый пуск показан как просрочка`).toBe(false);
    }
  });

  test('после пуска задание не «пора», пока не прошёл срок', async () => {
    await pretendRan('backup', 2);
    const backup = (await jobStates()).find((s) => s.name === 'backup')!;
    expect(backup.due, 'задание пора запускать через два часа при сроке 24').toBe(false);
    expect(backup.overdue).toBe(false);
  });

  test('молчание дольше срока — ТРЕВОГА', async () => {
    // Полтора срока: 36 часов при сроке 24. Это и есть случай «планировщик встал».
    await pretendRan('backup', 36);
    const backup = (await jobStates()).find((s) => s.name === 'backup')!;
    expect(backup.due, 'пора запускать').toBe(true);
    expect(backup.overdue, 'ПЛАНИРОВЩИК МОЛЧИТ, А ТРЕВОГИ НЕТ').toBe(true);
    expect(backup.hoursSince).toBeGreaterThan(35);
  });

  test('опоздание на час при сроке 24 — не тревога', async () => {
    await pretendRan('backup', 25);
    const backup = (await jobStates()).find((s) => s.name === 'backup')!;
    expect(backup.due).toBe(true);
    // Запас в половину срока: опоздание на час бывает от перезапуска, и поднимать по
    // нему тревогу — значит приучить не смотреть на тревоги.
    expect(backup.overdue, 'часовое опоздание показано как просрочка').toBe(false);
  });

  test('чему пора — то и в списке на запуск', async () => {
    expect((await dueJobs()).length, 'всё «пора» при пустой истории').toBe(JOBS.length);

    await pretendRan('backup', 1);
    const due = await dueJobs();
    expect(due, 'задание, запущенное час назад, попало в очередь').not.toContain('backup');
    expect(due).toContain('stock-check');
  });

  test('выключенное вручную не запускается', async () => {
    await pretendRan('backup', 100);
    await pool.query(`update scheduled_job set enabled = 0 where name = 'backup'`);
    expect(await dueJobs(), 'выключенное задание попало в очередь').not.toContain('backup');
  });
});

describe('задания · пуск и история', () => {
  test('пуск записывает и начало, и конец, и длительность', async () => {
    const r = await runJob('stock-check', 'test');
    expect(r.status, `задание не выполнилось: ${r.message}`).toBe('ok');

    const rows = await runRows('stock-check');
    expect(rows.length, 'пуск не записан').toBe(1);
    expect(rows[0]!.status).toBe('ok');
    expect(rows[0]!.message, 'не сказано, что сделано').toBeTruthy();
    expect(rows[0]!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('состояние обновляется после пуска', async () => {
    await runJob('stock-check', 'test');
    const s = (await jobStates()).find((x) => x.name === 'stock-check')!;
    expect(s.lastRunAt, 'время пуска не сохранилось').toBeTruthy();
    expect(s.lastStatus).toBe('ok');
    expect(s.due, 'сразу после пуска задание снова пора').toBe(false);
  });

  test('ЧТО ИМЕННО СДЕЛАНО — а не просто «выполнено»', async () => {
    const r = await runJob('stock-check', 'test');
    // Сообщение должно говорить, что нашли, а не что «всё хорошо»: иначе по истории
    // нельзя понять, проверяли ли что-нибудь вообще.
    expect(r.message, 'сообщение ничего не говорит о работе').toMatch(/расхождени/);
  });

  test('сбой записывается как сбой, а не как молчание', async () => {
    // Ломаем ПРЕДУСЛОВПРЕДУСЛОВИЕЕ задания, а не обвязку: переименовываем представление, по
    // которому сверяется остаток. Заодно это доказывает, что задание ДЕЙСТВИТЕЛЬНО
    // читает данные, а не отдаёт заготовленный ответ.
    await pool.query(`alter view line_view rename to line_view_hidden`);
    try {
      const r = await runJob('stock-check', 'test');
      expect(r.status, 'СБОЙ НЕ ЗАМЕЧЕН — задание отчиталось успехом').toBe('failed');
      expect(r.message).toBeTruthy();

      const rows = await runRows('stock-check');
      expect(rows[0]!.status).toBe('failed');
      expect(rows[0]!.message, 'причина сбоя не записана').toBeTruthy();
    } finally {
      await pool.query(`alter view line_view_hidden rename to line_view`);
    }
  });

  test('счётчик подряд неудачных растёт и сбрасывается удачей', async () => {
    await pool.query(`alter view line_view rename to line_view_hidden`);
    try {
      await runJob('stock-check', 'test');
      await runJob('stock-check', 'test');

      let s = (await jobStates()).find((x) => x.name === 'stock-check')!;
      // «Падает каждый раз» и «упало один раз» требуют разных действий, и различить
      // ихх по одной записи нельзя.
      expect(s.failedStreak, 'две неудачи подряд не посчитаны').toBe(2);
    } finally {
      await pool.query(`alter view line_view_hidden rename to line_view`);
    }

    await runJob('stock-check', 'test');
    const s = (await jobStates()).find((x) => x.name === 'stock-check')!;
    expect(s.failedStreak, 'счётчик не сброшен удачным пуском').toBe(0);
    expect(s.lastStatus).toBe('ok');
  });

  test('СБОЙ НЕ ОТКЛЮЧАЕТ ЗАДАНИЕ, А УСКОРЯЕТ ПОВТОР', async () => {
    await pool.query(`alter view line_view rename to line_view_hidden`);
    try {
      await runJob('stock-check', 'test');
      await runJob('stock-check', 'test');
    } finally {
      await pool.query(`alter view line_view_hidden rename to line_view`);
    }

    // Молча переставшее работать задание — ровно та поломка, от которой уходим.
    // Но проверяем не только «не отключилось»: упавшее задание должно ПОВТОРИТЬСЯ
    // раньше срока. Первая версия ждала полные 24 часа — упавшее ночью не
    // повторилось ббы до следующей ночи.
    const s = (await jobStates()).find((x) => x.name === 'stock-check')!;
    expect(s.failedStreak).toBe(2);
    expect(s.retryHours, 'после двух сбоев повтор ждёт полный срок')
      .toBeLessThan(s.everyHours);
    expect(s.retryHours, 'повтор назначен раньше часа — это поток записей')
      .toBeGreaterThanOrEqual(1);
  });

  test('идущее задазаданиеие не запускается вторым проходом', async () => {
    // Оставляем в истории запись «running» — так выглядит задание, которое сейчас
    // выполняется. Второй пуск того же задания дал бы два `pg_dump` на одну базу.
    await pool.query(
      `insert into scheduled_job_run (name, status) values ('stock-check', 'running')`);
    await pretendRan('stock-check', 100);

    expect(await dueJobs(), 'задание запущено повторно, пока идёт первое')
      .not.toContain('stock-check');
  });

  test('неизвестное задание запустить нельзя', async () => {
    await expect(runJob('нет-такого', 'test')).rejects.toThrow();
  });
});

describe('задания · экран', () => {
  test('администратору открыт, менеджеру — нет', async () => {
    expect((await html('/jobs', asAdmin)).status).toBe(200);
    const denied = await html('/jobs', asManager);
    expect(denied.status, 'менеджер открыл рарасписаниеписание заданий').toBe(403);
    expect(denied.body).toContain('job.run');
  });

  test('просрочка стоит первой и названа', async () => {
    await pretendRan('backup', 40);
    const { body } = await html('/jobs', asAdmin);

    expect(body).toContain('data-testid="jobs-alarm"');
    expect(body).toContain('data-testid="job-overdue-backup"');
    expect(body, 'не сказано, сколько молчит').toContain('ПРОСРОЧЕНО');
  });

  test('когда всё в порядке — это сказано словами', async () => {
    await pretendRan('backup', 1);
    await pretendRan('stock-check', 1);
    await pretendRan('notices-daily', 1);

    const { body } = await html('/jobs', asAdmin);
    expect(body).toContain('data-testid="jobs-all-ok"');
    expect(body, 'тревога показана, хотя всё в порядке').not.toContain('data-testid="jobs-alarm"');
  });

  test('у каждого задания видно, отчего оно вообще есть', async () => {
    const { body } = await html('/jobs', asAdmin);
    for (const def of JOBS) {
      expect(body, `нет карточки задания «${def.name}»`).toContain(`data-testid="job-${def.name}"`);
      expect(body, `нет кнопки пуска «${def.name}»`).toContain(`data-testid="job-run-${def.name}"`);
      expect(body, `не сказано, зачем нужно «${def.name}»`).toContain(def.purpose.slice(0, 30));
    }
  });

  test('пустая история объясняетсобъясняется словами', async () => {
    const { body } = await html('/jobs', asAdmin);
    expect(body).toContain('data-testid="jobs-no-history"');
    expect(body, 'не сказано, когда ждать первого пуска').toContain('раз в минуту');
  });

  test('запуск вручную отвечает, ЧЕМ КОНЧИЛОСЬ', async () => {
    const r = await uiPost('/ui/jobs/stock-check/run', asAdmin);
    expect(r.status).toBe(200);

    const body = await r.text();
    expect(body).toContain('data-testid="jobs-run-result"');
    expect(body, 'не сказано, что сделано').toMatch(/выполнено|ОШИБКА/);
    expect(body, 'результат не сохранён в истории').toContain('data-testid="jobs-history"');
  });

  test('запуск вручную сбивает срок следующего', async () => {
    await pretendRan('stock-check', 100);
    expect(await dueJobs()).toContain('stock-check');

    await uiPost('/ui/jobs/stock-check/run', asAdmin);
    expect(await dueJobs(), 'после ручного пуска задание снова в очереди')
      .not.toContain('stock-check');
  });

  test('менеджер запустить не может', async () => {
    expect((await uiPost('/ui/jobs/stock-check/run', asManager)).status).toBe(403);
  });

  test('неизвестное задание — 404, а не «запущено»', async () => {
    expect((await uiPost('/ui/jobs/нет-такого/run', asAdmin)).status).toBe(404);
  });

  test('вход на экран есть с дашборда', async () => {
    const { body } = await html('/', asAdmin);
    expect(body, 'входа в задания нет на дашборде').toContain('data-testid="dash-jobs"');
  });
});

describe('задания · проход планировщика', () => {
  test('проход запускает ТОЛЬКО то, чему пора', async () => {
    // Всё, кроме одного, только что запускалось: проход должен взять одно задание, а
    // не все подряд. Иначе ежедневная копия снималась бы каждую минуту.
    await pretendRan('backup', 1);
    await pretendRan('notices-daily', 1);

    const started = await tick();
    expect(started, 'проход взялся не за то').toEqual(['stock-check: ok']);
  });

  test('проход не берётся за то, что уже запущено', async () => {
    await pretendRan('backup', 100);
    await pretendRan('stock-check', 100);
    await pretendRan('notices-daily', 100);

    // Оставляем след идущего задания: так выглядит работа, которая уже идёт.
    await pool.query(
      `insert into scheduled_job_run (name, status) values ('backup', 'running')`);

    const started = await tick();
    expect(started, 'проход запустил задание, которое уже идёт')
      .not.toContain('backup: ok');
  });

  test('пустой проход — не ошибка', async () => {
    for (const def of JOBS) await pretendRan(def.name, 1);
    expect(await tick(), 'проход нашёл работу там, где её нет').toEqual([]);
  });
});

describe('задания · расписание не выдумано', () => {
  test('у каждого задания есть срок, смысл и расписание словами', () => {
    for (const def of JOBS) {
      expect(def.everyHours, `${def.name}: срок не задан`).toBeGreaterThan(0);
      expect(def.purpose.length, `${def.name}: не сказано, зачем нужно`).toBeGreaterThan(30);
      expect(def.schedule, `${def.name}: расписание не описано словами`).toBeTruthy();
    }
  });

  test('копия стоит первой — без неё остальное бессмысленно', () => {
    // Порядок в реестре — это порядок на экране. Копия должна быть наверху.
    expect(JOBS[0]!.name).toBe('backup');
  });
});
