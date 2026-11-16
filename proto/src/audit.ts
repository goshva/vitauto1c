import type { Context } from 'hono';
import { pool } from './db.ts';
import { actorOf } from './auth.ts';

// Журнал действий: запись и чтение.
//
// ЗАЧЕМ. «Кто изменил цену» — первый вопрос при разборе претензии. До этого журнала
// ответить было нечем: `updated_at` говорил, что строку трогали, но не кто и не что
// было до этого.
//
// ПОЧЕМУ ЗАПИСЬ НЕ ЛОМАЕТ ОСНОВНУЮ ОПЕРАЦИЮ. Журнал — свидетель, а не участник: если
// он не запишется, менять данные всё равно нужно, и откатывать правку из-за него
// нельзя. Поэтому ошибка записи ловится и попадает в лог сервера, а операция
// завершается. Обратное решение («нет журнала — нет правки») превратило бы сбой
// журнала в остановку работы склада.
//
// ПОЧЕМУ ЛОГИН ДОБАВЛЯЕТСЯ ЗДЕСЬ, А НЕ БЕРЁТСЯ ИЗ СЕССИИ. В сессии его нет: там
// идентификатор и роль. Смотреть учётную запись на КАЖДУЮ запись журнала — лишний
// запрос, поэтому логин разрешается один раз на запрос и запоминается в контексте.

export interface AuditEntry {
  /** Таблица, которую меняли: `line`, `customer_order`, `receipt`… */
  entity: string;
  entityId: string;
  /**
   * `step` — сдвиг строки по шагам процесса.
   *
   * ОТДЕЛЬНЫЙ ВИД, А НЕ `transition`, хотя состояние при этом меняется: по журналу потом
   * спрашивают «кто двигал строку по процессу», и ответ «переход в состояние X» на этот
   * вопрос не отвечает — он не говорит, на каком шаге строка была и на какой встала.
   */
  action: 'create' | 'update' | 'delete' | 'transition' | 'step';
  /** Поле, если меняли одно. */
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  comment?: string;
  details?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  at: string;
  login: string | null;
  role: string | null;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  comment: string | null;
}

const text = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

/** Логин действующего лица. Один запрос на запрос — дальше из памяти контекста. */
async function loginOf(c: Context, userId: string | null): Promise<string | null> {
  if (!userId) return null;

  const cached = c.get('auditLogin') as string | undefined;
  if (cached !== undefined) return cached;

  const r = await pool.query<{ login: string }>(
    `select login from app_user where id = $1`, [userId]);
  const login = r.rows[0]?.login ?? null;
  c.set('auditLogin', login ?? '');
  return login;
}

/**
 * Записать действие.
 *
 * Никогда не бросает: см. комментарий в начале файла.
 */
export async function record(c: Context, entry: AuditEntry): Promise<void> {
  try {
    const { userId, role } = actorOf(c);
    const login = await loginOf(c, userId);

    await pool.query(
      `insert into audit_log (user_id, login, role, entity, entity_id, action,
                              field, old_value, new_value, comment, trace_id, details)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        userId, login, role, entry.entity, entry.entityId, entry.action,
        entry.field ?? null, text(entry.oldValue), text(entry.newValue),
        entry.comment ?? null,
        (c.get('requestId') as string | undefined) ?? null,
        entry.details ?? {},
      ],
    );
  } catch (e) {
    // Свидетель не должен ронять работу. Но и молчать нельзя: без этой строки сбой
    // журнала остался бы вовсе незамеченным.
    console.error(`[audit] не записано: ${(e as Error).message}`);
  }
}

/**
 * История одной записи: от свежих к старым.
 *
 * Порядок именно такой: при разборе претензии нужен последний, кто тронул, а не
 * первый.
 */
export async function historyFor(
  entity: string,
  entityId: string,
  limit = 100,
): Promise<AuditRow[]> {
  const r = await pool.query<{
    id: string; at: Date; login: string | null; role: string | null; action: string;
    field: string | null; old_value: string | null; new_value: string | null;
    comment: string | null;
  }>(
    `select id, at, login, role, action, field, old_value, new_value, comment
       from audit_log
      where entity = $1 and entity_id = $2
      order by at desc, id desc
      limit $3`,
    [entity, entityId, limit],
  );

  return r.rows.map((x) => ({
    id: x.id,
    at: x.at.toISOString(),
    login: x.login,
    role: x.role,
    action: x.action,
    field: x.field,
    oldValue: x.old_value,
    newValue: x.new_value,
    comment: x.comment,
  }));
}
