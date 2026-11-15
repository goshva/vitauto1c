import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { TableFingerprint } from './backup-types.ts';

// Доступ к базе для копий: адрес, слепок содержимого, итог.
//
// ГЛАВНОЕ РЕШЕНИЕ ЗДЕСЬ — ЧТО ИМЕННО СЧИТАЕТСЯ ДОКАЗАТЕЛЬСТВОМ КОПИИ.
//
// Размер файла ничего не доказывает: дамп может быть усечён и при этом весить
// правдоподобно. Число таблиц — тоже: оно не меняется. Поэтому снимается СЛЕПОК
// СОДЕРЖИМОГО каждой таблицы: контрольная сумма всех строк по порядку. Она ловит и
// пропавшие строки, и изменённые значения.
//
// И слепок снимается С БАЗЫ В МОМЕНТ КОПИИ, а не с копии: сравнение копии с самой
// собой сходится всегда — это и есть та проверка, которая ничего не проверяет.

export const PG_BIN = 'C:\\Program Files\\PostgreSQL 1C\\18\\bin';

/** Адрес базы. Пароль берётся из окружения, чтобы не дублировать его в вызовах. */
export function dbUrl(name = 'vitauto_proto'): string {
  return `postgres://postgres:${process.env.PGPASSWORD ?? 'postgres'}@127.0.0.1:5434/${name}`;
}

/** Окружение с паролем: его ждут все утилиты PostgreSQL. */
export function pgEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'postgres' };
}

/**
 * Слепок содержимого всех таблиц схемы `public`.
 *
 * `md5(string_agg(...))` по всем строкам: считает и число, и значения. Порядок
 * задаём явно — иначе сумма «поехала» бы при том же содержимом.
 *
 * Представления пропускаем: они не данные, а запросы, и в копии их восстанавливает
 * не дамп данных.
 */
export function snapshot(url: string, env: NodeJS.ProcessEnv): TableFingerprint[] {
  const sql = `
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`;

  const names = execFileSync(`${PG_BIN}\\psql.exe`, [url, '-Atc', sql], { encoding: 'utf8', env })
    .split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '');

  const out: TableFingerprint[] = [];
  for (const table of names) {
    // Имя таблицы подставляется текстом, поэтому берём его ТОЛЬКО из системного
    // каталога: значения из аргументов сюда не попадают.
    //
    // В ��АПРОСЕ НЕТ НИ ОДНОГО НЕ-ASCII СИМВОЛА — и это не стилистика. Кириллица в
    // аргументе командной строки Windows перекодируется в CP866, и psql получает байты
    // там, где ждёт UTF-8: `invalid byte sequence`. Первая версия писала
    // `coalesce(..., 'пусто')` и падала ровно на этом — нарушив правило, которое я сам
    // записал в `docs/tooling.md` часом раньше. Для пустой таблицы — пустая строка.
    const row = execFileSync(
      `${PG_BIN}\\psql.exe`,
      [url, '-Atc',
        `select count(*)::text || '|' ||
                md5(coalesce(string_agg(x.line, chr(10) order by x.line), ''))
           from (select t::text as line from "${table}" t) x`],
      { encoding: 'utf8', env },
    ).trim();

    const [rows, checksum] = row.split('|');
    out.push({ table, rows: Number(rows), checksum: checksum ?? '' });
  }
  return out;
}

/** Итог по таблицам: одна строка для сравнения и для описи. */
export function totals(tables: TableFingerprint[]): { rows: number; checksum: string } {
  return {
    rows: tables.reduce((s, t) => s + t.rows, 0),
    checksum: createHash('sha256')
      .update(tables.map((t) => `${t.table}:${t.rows}:${t.checksum}`).join('\n'))
      .digest('hex'),
  };
}
