import { pool } from './db.ts';
import { PROCESSES } from './domain/process-map.ts';
import { statusTitle } from './domain/status.ts';

// Уведомления АРМ (ФТ v2 п. 17).
//
// Заказчик подтвердил (14.11.2026): «это уведомления АРМ вместо задач 1С». Значит,
// штатные «Задачи/Напоминания» 1С не используются, а уведомление создаёт сам АРМ.
//
// ЧТО БЫЛО НЕ ТАК. Таблица `notice` существовала с самого начала, и я отметил
// пункт закрытым по наличию колонки `customer_order_id`. Но в `src/` не было НИ
// ОДНОЙ вставки в неё: таблица была мёртвой, и уведомления не создавались вовсе.
// Поймал тест — тот, который проверял не схему, а работу.
//
// КОМУ АДРЕСОВАНО. Роль берётся из КАРТЫ ПРОЦЕССОВ, а не из таблицы в коде: у шага
// процесса уже указано, кто его выполняет. Так адресат не разойдётся с процессом —
// а расхождение тут было бы незаметным: уведомление ушло бы не тому, и никто бы
// не пожаловался.

/** Роли, ответственные за состояние, по карте процессов. */
function rolesFor(status: string): { roles: string[]; node: string } {
  for (const p of PROCESSES) {
    for (const step of p.steps) {
      if (step.status === status) {
        return { roles: step.roles, node: step.nodes.join('+') };
      }
    }
  }
  return { roles: [], node: '' };
}

/**
 * Уведомить о смене состояния строки.
 *
 * Ошибку глотаем намеренно: уведомление — вспомогательное, и падение на нём не
 * должно откатывать сам переход. Иначе операция, которая прошла бы и без
 * уведомления, начнёт падать из-за него.
 */
export async function notifyStatus(
  lineId: string,
  to: string,
  customerOrderId: string | null,
): Promise<void> {
  try {
    const { roles, node } = rolesFor(to);
    if (roles.length === 0) return;

    const name = await pool.query<{ name: string | null }>(
      `select coalesce(f.fact_name, l.internal_order_number, l.id::text) as name
         from line l left join line_fact f on f.id = l.id
        where l.id = $1`,
      [lineId],
    );
    const title = name.rows[0]?.name ?? lineId;
    const text = `«${title}» → ${statusTitle(to)}`;

    for (const role of roles) {
      await pool.query(
        `insert into notice (node, kind, recipient_role, text, customer_order_id)
         values ($1, 'status', $2, $3, $4)`,
        [node || null, role, text, customerOrderId],
      );
    }
  } catch {
    // Уведомление не должно ронять переход — см. комментарий выше.
  }
}

/** Непрочитанные уведомления роли. */
export async function unreadFor(role: string): Promise<{ text: string; at: Date }[]> {
  const r = await pool.query<{ text: string; created_at: Date }>(
    `select text, created_at from notice
      where recipient_role = $1 and not is_read
      order by created_at desc limit 50`,
    [role],
  );
  return r.rows.map((x) => ({ text: x.text, at: x.created_at }));
}
