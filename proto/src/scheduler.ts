import { dueJobs, runJob } from './jobs-run.ts';

// Планировщик: то, что запускает задания без человека.
//
// ПОЧЕМУ ВНУТРИ ПРИЛОЖЕНИЯ, А НЕ ВО ВНЕШНЕМ ПЛАНИРОВЩИКЕ. Внешний (Task Scheduler,
// cron) надёжнее в теории, но требует, чтобы кто-то его настроил, — а настройка
// планировщика в чужой системе и есть то, что забывают при развёртывании. Здесь он
// поднимается вместе с приложением: нечего настраивать.
//
// ЧТО ЭТО СТОИТ. Если приложение не запущено, задания не идут. Это осознанно: система,
// которая не работает, и задания выполнять не долдолжнана — иначе копии снимались бы с
// остановленной базы. Пропущенное догоняется при следующем старте: состояние считается
// по «прошло ли больше положенного», а не по «наступило ли время по календарю».

const TICK_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

/** Один проход: запустить всё, чему пора. */
export async function tick(now = new Date()): Promise<string[]> {
  const due = await dueJobs();
  const started: string[] = [];

  for (const name of due) {
    // Последовательно, а не разом: задания трогают одну базу, и одновременный
    // `pg_dump` с проверкой остатков дал бы нагрузку без пользы.
    const result = await runJob(name, 'schedule');
    started.push(`${name}: ${result.status}`);
    console.log(`[job:${name}] ${result.status} за ${result.durationMs} мс — ${now.toISOString()}`);
  }
  return started;
}

/** Поднять планировщик. Вызывается при прямом запуске сервера. */
export function startScheduler(): void {
  if (timer !== null) return;
  // Первый проход — сразу, но НЕ в момент старта: сервер должен сперва начать
  // отвечать, иначе первый же запрос ждёт окончания копии.
  setTimeout(() => { void tick(); }, 5_000);
  timer = setInterval(() => { void tick(); }, TICK_MS);
  console.log(`планировщик поднят: проверка каждые ${TICK_MS / 1000} с`);
}

export function stopScheduler(): void {
  if (timer !== null) { clearInterval(timer); timer = null; }
}
