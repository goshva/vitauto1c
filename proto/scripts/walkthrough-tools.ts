import { app } from '../src/server.ts';
import { pool } from '../src/db.ts';
import { encodeSession } from '../src/session.ts';

// СРЕДСТВА ПРОВЕРКИ ЧЕРЕЗ ПРИЛОЖЕНИЕ: отметить строку, обратиться к маршруту, убрать следы.
//
// Вынесено из `verify-walkthrough.ts` по размеру, но разделение вышло по смыслу: здесь
// вспомогательное — то, что одинаково для любой проверки через приложение.
//
// `pg` берётся из проекта, а не объявляется типом: у пула и у одиночного клиента разные
// наборы свойств, и подменять один другим в подписи нельзя — TypeScript это и показал.

export const cookie = `arm_session=${encodeSession({
  userId: '11111111-aaaa-1111-1111-111111111101', role: 'admin',
})}`;

/** Запрос к маршруту API с телом JSON. */
export async function json(
  url: string, body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
}

/**
 * Отмечена ли строка сейчас.
 *
 * Внутренняя: снаружи нужны «отметить» и «снять отметку», а не вопрос о состоянии. Пять
 * именных экспортов — предел §12, и тратить один на вспомогательный вопрос не стоит.
 */
const isMarked = async (id: string): Promise<boolean> => {
  const r = await pool.query<{ marked: boolean }>(
    `select coalesce(marked, false) as marked from line_mark where id = $1`, [id]);
  return r.rows[0]?.marked === true;
};

/**
 * Отметить строку — ЕСЛИ ОНА ЕЩЁ НЕ ОТМЕЧЕНА.
 *
 * Маршрут отметки — ПЕРЕКЛЮЧАТЕЛЬ: он снимает отметку, если она стоит. На отказе (а отказ на
 * границе процесса отметку не снимает) я «отмечал» строку второй раз и тем самым её
 * РАСсмаркировал. Следующий запрос не находил отмеченных строк и отказывал — а выглядело
 * это как «не вернулся к началу».
 *
 * Проверка, не следящая за состоянием, о котором сама же просит, обвиняет код в своих
 * ошибках.
 */
export async function mark(id: string): Promise<void> {
  if (await isMarked(id)) return;
  await app.request(`/ui/lines/${id}/toggle`, { method: 'POST', headers: { cookie } });
}

/** Снять отметку — ЕСЛИ ОНА СТОИТ. Отказ на границе отметку не снимает. */
export async function unmark(id: string): Promise<void> {
  if (!await isMarked(id)) return;
  await app.request(`/ui/lines/${id}/toggle`, { method: 'POST', headers: { cookie } });
}

/**
 * УБРАТЬ СЛЕДЫ ПРОВЕРКИ.
 *
 * Проверка двигает НАСТОЯЩИЕ строки, и после неё остаются записи журнала и уведомления АРМ.
 * Их надо убрать: иначе в журнале появится сотня записей «сдвинул по шагу», которых в работе
 * не было, и журнал перестанет быть свидетельством.
 *
 * ЧЕРТА ВРЕМЕНИ, А НЕ СПИСОК СТРОК. Уведомление АРМ привязано к ЗАКАЗУ, а не к строке:
 * таблица `notice` не хранит `line_id`. Удалять по заказу значило бы стереть и законные
 * уведомления по нему. Черта времени отделяет след проверки точно.
 */
export async function cleanArtifacts(
  db: typeof pool, since: Date, touched: string[],
): Promise<{ journal: number; notices: number; marks: number; lines: number }> {
  const journal = await db.query(
    `delete from audit_log where action = 'step' and at >= $1`, [since]);
  const notices = await db.query(`delete from notice where created_at >= $1`, [since]);
  const marks = await db.query(
    `update line_mark set marked = false where id = any($1::uuid[])`, [touched]);
  // Строки возвращаются на первый шаг: проверка не должна менять то, что смотрят глазами.
  const lines = await db.query(
    `update line set process_step = 1 where id = any($1::uuid[])`, [touched]);

  return {
    journal: journal.rowCount ?? 0,
    notices: notices.rowCount ?? 0,
    marks: marks.rowCount ?? 0,
    lines: lines.rowCount ?? 0,
  };
}
