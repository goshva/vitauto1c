import { pool } from './db.ts';
import { JOBS, jobByName, type JobContext } from './jobs.ts';

// Запускатель заданий: выполнить, записать, показать состояние.
//
// ТРИ ПРАВИЛА, БЕЗ КОТОРЫХ ЭТО БЕСПОЛЕЗНО.
//
// 1. КАЖДЫЙ ПУСК — СТРОКА В ИСТОРИИ. Задание, которое не запускалось и нигде об этом
//    не сказало, равносильно отсутствующему. Планировщик, тихо переставший работать,
//    выглядит как работающий — и это замечают последним.
//
// 2. ПРОСРОЧКА ВИДНА. СосСостояниеояние задания считается не по «запускалось ли когда-нибудь»,
//    а по «прошло ли больше, чем положено». Поэтому в состоянии есть `overdue` — и на
//    экране оно первое, что бросается в глаза.
//
// 3. СБОЙ НЕ ВРАЩАЕТ РАСПИСАНИЕ ВСПЯТЬ. Неудачный пуск отмечается, счётчик подряд
//    неудачных растёт, но задание не отключается само: молча переставшее работать
//    задание — ровно та поломка, от которой мы уходим.

export interface JobState {
  name: string;
  title: string;
  schedule: string;
  purpose: string;
  everyHours: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  failedStreak: number;
  /** Часов до следующего пуска. После сбоя меньше срока — задание повторится раньше. */
  retryHours: number;
  /** Часов с последнего пуска. Пусто — не запускалось ни разу. */
  hoursSince: number | null;
  /** Пора запускать. */
  due: boolean;
  /** Пора, и заметно пора — на экране это тревога, а не строка списка. */
  overdue: boolean;
  /** Идёт прямо сейчас. */
  running: boolean;
}

/** Запустить задание и записать итог. Бросает, только если задание не найдено. */
export async function runJob(name: string, startedBy = 'schedule'): Promise<{
  status: 'ok' | 'failed';
  message: string;
  durationMs: number;
}> {
  const def = jobByName(name);
  if (!def) throw new Error(`Задание «${name}» не найдено`);

  // Отметка о старте — ДО работы: иначе упавшее на первом шаге задание не оставит
  // следа вовсе, а «его не было в истории» и «оно упало» — разные вещи.
  const startedAt = new Date();
  const run = await pool.query<{ id: string }>(
    `insert into scheduled_job_run (name, status, started_by)
     values ($1, 'running', $2) returning id`,
    [name, startedBy],
  );
  const runId = run.rows[0]!.id;

  const ctx: JobContext = {
    startedBy,
    // Глубокая проверка (восстановление копии) — по воскресеньям и по кнопке.
    deep: startedBy !== 'schedule' || new Date().getDay() === 0,
  };

  try {
    const result = await def.run(ctx);
    const durationMs = Date.now() - startedAt.getTime();

    await pool.query(
      `update scheduled_job_run
          set status = 'ok', message = $2, finished_at = now(), duration_ms = $3
        where id = $1`,
      [runId, result.message, durationMs],
    );
    await pool.query(
      `insert into scheduled_job (name, title, schedule, every_hours, last_run_at,
                                  last_status, failed_streak, enabled)
       values ($1, $2, $3, $4, now(), 'ok', 0, 1)
       on conflict (name) do update
         set last_run_at = now(), last_status = 'ok', failed_streak = 0`,
      [name, def.title, def.schedule, def.everyHours],
    );

    return { status: 'ok', message: result.message, durationMs };
  } catch (e) {
    const durationMs = Date.now() - startedAt.getTime();
    const message = (e as Error).message.split('\n')[0] ?? 'ошибка';

    await pool.query(
      `update scheduled_job_run
          set status = 'failed', message = $2, finished_at = now(), duration_ms = $3
        where id = $1`,
      [runId, message, durationMs],
    );
    // Счётчик подряд неудачных — чтобы «падает каждый раз» отличалось от «упало раз».
    await pool.query(
      `insert into scheduled_job (name, title, schedule, every_hours, last_run_at,
                                  last_status, failed_streak, enabled)
       values ($1, $2, $3, $4, now(), 'failed', 1, 1)
       on conflict (name) do update
         set last_run_at = now(), last_status = 'failed',
             failed_streak = scheduled_job.failed_streak + 1`,
      [name, def.title, def.schedule, def.everyHours],
    );

    console.error(`[job:${name}] не выполнено: ${message}`);
    return { status: 'failed', message, durationMs };
  }
}

/** Состояние всех заданий — для экрана и для проверки просрочки. */
export async function jobStates(): Promise<JobState[]> {
  const r = await pool.query<{
    name: string; last_run_at: Date | null; last_status: string | null;
    failed_streak: number; running: boolean;
  }>(
    `select j.name, j.last_run_at, j.last_status, j.failed_streak,
            exists (select 1 from scheduled_job_run r
                     where r.name = j.name and r.status = 'running') as running
       from scheduled_job j`,
  );
  const byName = new Map(r.rows.map((x) => [x.name, x]));

  return JOBS.map((def) => {
    const row = byName.get(def.name);
    const last = row?.last_run_at ?? null;
    const hoursSince = last === null ? null : (Date.now() - last.getTime()) / 3_600_000;
    const failedStreak = row?.failed_streak ?? 0;
    const lastStatus = row?.last_status ?? null;

    // ПОСЛЕ СБОЯ ПОВТОР ИДЁТ РАНЬШЕ — И НЕ СРАЗУ. Первая версия ждала полный срок:
    // упавшее ночью задание не повторилось бы до следующей ночи. Но и повторять
    // каждую минуту нельзя — постоянная ошибка превратилась бы в поток записей.
    // Нарастающая задержка: час, два, четыре… но не больше самого срока.
    const retryHours = lastStatus === 'failed'
      ? Math.min(2 ** (failedStreak - 1), def.everyHours)
      : def.everyHours;

    return {
      name: def.name,
      title: def.title,
      schedule: def.schedule,
      purpose: def.purpose,
      everyHours: def.everyHours,
      retryHours,
      lastRunAt: last === null ? null : last.toISOString(),
      lastStatus,
      failedStreak,
      hoursSince,
      // Не запускавшееся ни разу — пора запускать.
      due: hoursSince === null || hoursSince >= retryHours,
      // Просрочка считается ПО СРОКУ, а не по задержке повтора: о сбое говорит
      // счётчик, и поднимать по нему тревогу значит смешать два сообщения в одно.
      overdue: hoursSince !== null && hoursSince >= def.everyHours * 1.5,
      running: row?.running ?? false,
    };
  });
}

/** Задания, которым пора. Для планировщика — без учёта выключенных вручную. */
export async function dueJobs(): Promise<string[]> {
  const disabled = await pool.query<{ name: string }>(
    `select name from scheduled_job where enabled = 0`);
  const off = new Set(disabled.rows.map((x) => x.name));
  return (await jobStates()).filter((s) => s.due && !s.running && !off.has(s.name))
    .map((s) => s.name);
}
