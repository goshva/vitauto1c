import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from '../src/db.ts';

// Применение миграций. Идемпотентно: Drizzle ведёт таблицу учёта применённых
// миграций, поэтому повторный запуск ничего не делает (гейт этапа 1).
//
// Миграции только вверх: прототип не откатывается на живых данных,
// вместо откатов — пересоздание базы (`bun run db:reset`).

const dir = resolve(import.meta.dir, 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

if (files.length === 0) {
  console.log('миграций нет — сначала `bun run db:generate`');
  process.exit(1);
}

const db = drizzle(pool);
await migrate(db, { migrationsFolder: dir });

console.log(`миграции применены: ${files.length} файлов`);
await pool.end();
