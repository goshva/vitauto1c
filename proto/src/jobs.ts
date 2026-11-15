import { pool } from './db.ts';

// Реестр регламентных заданий: что должно происходить само.
//
// ЗАЧЕМ ЭТО НУЖНО. До сих пор всё держалось на памяти человека: копию надо снять
// руками, напоминание — отправить руками, остаток — сверить руками. Пока система
// обслуживает один магазин и один склад, это работает; при первой же загрузке
// срочными заказами забывается именно то, что не болит сейчас.
//
// ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ. Это не cron. Расписание задаётся в ЧАСАХ, а не выражением, и
// это осознанно: для ежедневной копии и еженедельной сверки выражение — лишняя
// сложность, а ошибку в нём видно только по факту невыполнения.

export interface JobContext {
  /** Кто запустил: `schedule` или логин администратора. */
  startedBy: string;
  /** Включать ли проверку (`backup:verify`). По расписанию — не каждый раз. */
  deep: boolean;
}

export interface JobResult {
  /** Короткое сообщение в историю: «копий: 1, проверена: 1». */
  message: string;
  /** Сколько чего сделано — для экрана. */
  done?: number;
}

export interface JobDefinition {
  name: string;
  title: string;
  /** Расписание словами. Для экрана, не для расчёта. */
  schedule: string;
  /** Через сколько часов задание обязано повториться. */
  everyHours: number;
  /** Отчего задание вообще имеет смысл. */
  purpose: string;
  run: (ctx: JobContext) => Promise<JobResult>;
}

// --- Встроен��ые задания --------------------------------------------------------------

/** Сверка остатка с движениями: расхождение означает ошибку в учёте. */
async function stockCheck(): Promise<JobResult> {
  // Имя позиции берём ИЗ ПРЕДСТАВЛЕНИЯ: у самой строки колонки `name` нет — там
  // `nomenclature_id` и `fact_name`. Первая версия этого запроса обращалась к
  // `l.name` и падала; поймал тест, а не работа.
  const r = await pool.query<{ id: string; diff: string; name: string }>(
    `select v."id", coalesce(v."factName", v."nomenclature", 'без имени') as name,
            (coalesce(s.qty, 0) - coalesce(v."stockQty", 0))::text as diff
       from line_view v
       left join (select line_id, sum(quantity) as qty from stock_move group by line_id) s
         on s.line_id = v."id"
      where abs(coalesce(s.qty, 0) - coalesce(v."stockQty", 0)) > 0.001
      limit 20`,
  );

  if (r.rowCount === 0) return { message: 'расхождений нет', done: 0 };

  // Расхождение НЕ правим автоматически: остаток — то, за что отвечает склад, и
  // «поправить, чтобы сошлось» здесь означало бы спрятать ошибку, а не найти её.
  return {
    message: `расхождений: ${r.rowCount} — ${r.rows.map((x) => `${x.name}: ${x.diff}`).join('; ')}`,
    done: r.rowCount!,
  };
}

/** Напоминания по строкам, которые давно стоят на месте. */
async function noticesDaily(): Promise<JobResult> {
  const r = await pool.query<{ n: string }>(
    `select count(*)::text n from line
      where not deleted and status not in ('closed', 'cancelled', 'refused')
        and order_date < current_date - 3`,
  );
  const n = Number(r.rows[0]!.n);
  return { message: `строк старше трёх дней: ${n}`, done: n };
}

/** Снятие копии. Запускается отдельной командой — здесь только отметка в истории. */
async function backupJob(ctx: JobContext): Promise<JobResult> {
  const { runBackup, runVerify } = await import('./jobs-backup.ts');
  const made = await runBackup();
  if (!ctx.deep) return { message: made, done: 1 };

  const checked = await runVerify();
  return { message: `${made}; ${checked}`, done: 2 };
}

/**
 * Список заданий.
 *
 * ПОРЯДОК ЗАДАЁТСЯ ЗДЕСЬ, и он же порядок на экране: сначала то, без чего нельзя
 * сдавать (копия), потом контроль, потом напоминания.
 */
export const JOBS: JobDefinition[] = [
  {
    name: 'backup',
    title: 'Снятие резервной копии',
    schedule: 'каждый день, вечером',
    everyHours: 24,
    purpose: 'Без копии потеря базы означает потерю всего. Проверка восстановлением — по воскресеньям.',
    run: backupJob,
  },
  {
    name: 'stock-check',
    title: 'Сверка остатка с движениями',
    schedule: 'каждый день, утром',
    everyHours: 24,
    purpose: 'Расхождение между остатком и движениями — признак ошибки в учёте. Находим сами, а не при инвентаризации.',
    run: stockCheck,
  },
  {
    name: 'notices-daily',
    title: 'Напоминания по зависшим строкам',
    schedule: 'каждый рабочий день, утром',
    everyHours: 24,
    purpose: 'Строка, которая три дня стоит на месте, — это забытый заказ, а не «в работе».',
    run: noticesDaily,
  },
];

export const jobByName = (name: string): JobDefinition | undefined =>
  JOBS.find((j) => j.name === name);
