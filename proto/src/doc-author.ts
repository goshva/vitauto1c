import type { Context } from 'hono';
import { pool } from './db.ts';
import { checkAuthor } from './domain/document-rights.ts';
import { Problem } from './problem.ts';

// Права по автору для ДОКУМЕНТОВ (ФТ в2 п. 20, БТ п. 20).
//
// «Документ редактирует тот пользователь, который его создал; просмотр — по профилю
// группы доступа. Профиль „Администратор“ имеет полный доступ».
//
// На заказе это уже сделано — здесь та же проверка для остальных документов. Логика
// одна (`checkAuthor`), различается только способ достать автора: у каждого документа
// своя таблица.
//
// ПОЧЕМУ СПИСОК, А НЕ ИМЯ ТАБЛИЦЫ ИЗ ЗАПРОСА. Имя таблицы подставляется в SQL
// текстом, и взять его из адреса значило бы открыть подстановку. Здесь закрытый
// перечень: добавить документ можно только правкой кода.

const TABLES = [
  'customer_order', 'supplier_order', 'receipt', 'shipment',
  'return_order', 'work_order', 'invoice',
] as const;

export type DocumentTable = (typeof TABLES)[number];

/**
 * Проверяет право на изменение документа или возвращает `null`.
 *
 * Возвращает `null` и тогда, когда документа нет: решение «404 или 403» принимает
 * вызывающий, а он уже знает, что искал. Здесь только про автора.
 */
export async function checkDocAuthor(
  c: Context,
  table: DocumentTable,
  id: string,
): Promise<Problem | null> {
  if (!TABLES.includes(table)) {
    throw new Error(`Неизвестный документ «${table}»: список закрытый`);
  }

  const r = await pool.query<{ author_id: string | null }>(
    `select author_id from ${table} where id = $1`,
    [id],
  );
  if (r.rowCount === 0) return null;

  return checkAuthor(c, r.rows[0]!.author_id);
}
