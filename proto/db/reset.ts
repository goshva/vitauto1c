import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Полный сброс базы прототипа: снести схему → накатить миграции заново → залить справочники.
//
// Почему отдельное соединение, а не общий пул:
// при `drop schema public cascade` меняется OID схемы, а пул держит закешированное
// состояние каталога — следующий запрос падает с «relation … does not exist».
// Проверено: с общим пулом сид не находил таблицу unit.
//
// Почему сносится ещё и `drizzle`: там журнал применённых миграций. Если его не снести,
// после удаления таблиц мигратор считает всё применённым и молча ничего не создаёт —
// база остаётся пустой. Проверено.
//
// БЕЗОПАСНОСТЬ: скрипт отказывается работать, если DATABASE_URL не содержит
// «vitauto_proto». Ручной стенд (vitauto_app) сносить нельзя — он источник истины
// до приёмки прототипа (решение заказчика Q6).

const url = Bun.env.DATABASE_URL ?? '';
if (!url.includes('vitauto_proto')) {
  console.error(
    `ОТКАЗ: сброс разрешён только для базы прототипа (vitauto_proto), а указана:\n  ${url || '(пусто)'}\n` +
    'Ручной стенд vitauto_app не трогаем — см. prototype-spec.md §13.1 (Q6).',
  );
  process.exit(1);
}

// 1. Снос: своё соединение, которое сразу закрывается — чтобы не осталось
//    соединений со ссылками на старый OID схемы.
const dropper = new Pool({ connectionString: url, max: 1 });
await dropper.query('drop schema if exists public cascade');
await dropper.query('create schema public');
await dropper.query('drop schema if exists drizzle cascade');
await dropper.end();
console.log('схемы public и drizzle пересозданы');

// 2. Накат: свежий пул видит новую схему.
const pool = new Pool({ connectionString: url, max: 4 });
const db = drizzle(pool);
const dir = resolve(import.meta.dir, 'migrations');
await migrate(db, { migrationsFolder: dir });
console.log(`миграции применены: ${readdirSync(dir).filter((f) => f.endsWith('.sql')).length} файлов`);

// 3. Справочники — своим пулом, а не общим из src/db.ts: у общего соединения
//    сохранён старый OID схемы, и он не найдёт только что созданные таблицы.
const refsSql = readFileSync(resolve(import.meta.dir, 'seed/templates/refs.sql'), 'utf8');
await pool.query(refsSql);
console.log('справочники залиты');

await pool.end();
