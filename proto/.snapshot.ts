import { Client } from 'pg';

// СВЕРКА ПЕРВОСХОДНОСТИ: снимок приёмника ДО переноса.
//
// ЗАЧЕМ СНИМОК, А НЕ ПРОСТО СЧЁТ. Перенос идёт `on conflict do nothing`, и это верно —
// повторный прогон не удвоит. Но именно поэтому «сколько строк стало» ничего не доказывает:
// если перенос не записал НИ ОДНОЙ строки, число не изменится, и это будет выглядеть
// успехом.
//
// Снимок до и после показывает РАЗНИЦУ по каждой таблице. Ноль прироста там, где строки
// должны были появиться, — это провал, и его видно.

const TABLES = ['brand', 'nomenclature', 'counterparty', 'contract', 'car',
  'warehouse_zone', 'storage_cell', 'customer_order', 'line', 'line_fact'];

const db = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5434/vitauto_proto' });
await db.connect();

const counts: Record<string, number> = {};
for (const t of TABLES) {
  counts[t] = Number((await db.query(`select count(*)::int n from ${t}`)).rows[0]!.n);
}

await db.end();

// Печатаем в формате, который скрипт переноса сможет прочитать: одну строку JSON.
console.log(JSON.stringify({ at: new Date().toISOString(), counts }, null, 2));
