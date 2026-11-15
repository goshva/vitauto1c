import type { Context } from 'hono';
import { pool } from './db.ts';
import { record } from './audit.ts';

// Запись журнала для правки поля строки (БТ, аудит действий).
//
// Вынесено из `lines-fields.ts`: файл перешёл предел 200 строк из §12.
//
// ПОЧЕМУ СНАЧАЛА ЧИТАЕМ, ПОТОМ ПИШЕМ. SQL не отдаёт прежнее значение в RETURNING, а
// журналу нужно именно оно: «кто изменил цену» без «было» не отвечает ни на что.
// Чтение и запись идут раздельно, поэтому обе операции собраны здесь — держать их
// врозь значило бы однажды записать «стало», забыв «было».

/** Снимок значений до правки. Пустой объект, если строки нет. */
export async function snapshot(
  id: string,
  columns: string[],
): Promise<Record<string, string | null>> {
  if (columns.length === 0) return {};
  const list = columns.map((c) => `${c}::text as "${c}"`).join(', ');
  const r = await pool.query<Record<string, string | null>>(
    `select ${list} from line where id = $1`, [id]);
  return r.rows[0] ?? {};
}

/**
 * Записать правку поля строки.
 *
 * `details` — для связанных значений, которые меняются СЛЕДОМ за полем. Главный
 * случай — множитель: он двигает цену, и при разборе важно видеть, что цена
 * изменилась расчётом, а не вручную.
 */
export async function recordField(
  c: Context,
  args: {
    id: string;
    field: string;
    before: string | null;
    after: unknown;
    comment?: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await record(c, {
    entity: 'line',
    entityId: args.id,
    action: 'update',
    field: args.field,
    oldValue: args.before,
    newValue: args.after,
    comment: args.comment,
    details: args.details,
  });
}
