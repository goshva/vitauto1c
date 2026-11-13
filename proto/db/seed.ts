import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool } from '../src/db.ts';

// Запуск сидов. Два уровня (prototype-spec.md §2.3):
//   db/seed/templates/refs.sql   — справочные данные, «шаблон» системы
//   db/seed/processes/<id>.sql   — состояние под конкретный процесс
//
// Идемпотентность: refs через ON CONFLICT DO UPDATE, процессы через delete+insert.
// Повторный запуск приводит базу к тому же состоянию — проверяется тестом.
//
// Использование:
//   bun run db:seed              — только справочники
//   bun run db:seed happy        — справочники + состояние процесса happy
//   bun run db:seed --all        — справочники + все процессы

// seed.ts лежит в db/, а сами сиды — в db/seed/. Без этой поправки путь
// разворачивался в db/templates/refs.sql и падал с ENOENT.
const SEED_DIR = resolve(import.meta.dir, 'seed');

const read = (rel: string): string => readFileSync(resolve(SEED_DIR, rel), 'utf8');

/** Выполняет SQL-файл целиком. node-postgres умеет multi-statement без параметров. */
async function runSqlFile(rel: string): Promise<void> {
  await pool.query(read(rel));
}

/**
 * Редко нужные операции сида: витрина и полная очистка транзакций.
 *
 * Собраны в один экспорт, чтобы файл держал не больше пяти: частые операции
 * (`seedRefs`, `seedProcess`, `resetTo`, `processIds`) остаются отдельными —
 * их импортируют по двадцать файлов.
 */
export const seedExtra = { showcase: seedShowcase, clear: clearTransactions };

/** Идентификаторы процессов, для которых есть сид. */
export function processIds(): string[] {
  return readdirSync(resolve(SEED_DIR, 'processes'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();
}

/**
 * Очистка ВСЕХ транзакционных данных. Справочники не трогаются: они — «шаблон»
 * системы, а транзакции — состояние конкретного теста.
 *
 * Зачем экспортируется: витрине нужен чистый старт без строк процессов, иначе
 * «строк ровно столько, сколько пар процесс × состояние» не проверить.
 */
async function clearTransactions(): Promise<void> {
  await pool.query(
    `truncate table line_mark, line_fact, stock_move, line, customer_order, supplier_order,
                    receipt, shipment, return_order, work_order, notice, job, idempotency_key
     cascade`,
  );
}

/**
 * Состояние ОДНОГО процесса: полная очистка транзакций + строки этого процесса.
 *
 * Именно это вызывают тесты в `beforeEach` — так состояние известно и не зависит
 * от предыдущего теста. Второй процесс добавляется отдельно через `seedProcess`,
 * иначе его очистка снесла бы первый (проверено: `seedProcess('happy')` +
 * `seedProcess('stock')` оставлял в базе только stock).
 */
export async function resetTo(id: string): Promise<void> {
  await clearTransactions();
  await seedProcess(id);
}

/** Добавить состояние процесса БЕЗ очистки. Для случаев, когда нужно два процесса. */
export async function seedProcess(id: string): Promise<void> {
  if (!processIds().includes(id)) {
    throw new Error(`нет сида процесса «${id}». Есть: ${processIds().join(', ')}`);
  }
  await runSqlFile(`processes/${id}.sql`);
}

/** Справочные данные. Идемпотентно. */
export async function seedRefs(): Promise<void> {
  await runSqlFile('templates/refs.sql');
}

/**
 * Витрина: по строке на КАЖДЫЙ этап КАЖДОГО процесса + необходимые документы.
 *
 * Отдельно от `--all` намеренно: 61 строка и десятки документов сделали бы
 * состояние e2e непредсказуемым — тесты рассчитывают на состояние одного процесса.
 * Витрина нужна, чтобы увидеть карту процессов «живой» на всех этапах.
 */
async function seedShowcase(): Promise<void> {
  await runSqlFile('showcase.sql');
}

if (import.meta.main) {
  const arg = process.argv[2];
  await seedRefs();
  console.log('шаблоны справочников применены');

  if (arg === '--all') {
    // Сначала полная очистка транзакций: без неё остаются данные, накатанные
    // РАНЬШЕ вручную (например, витрина из 61 строки), и состояние перестаёт быть
    // воспроизводимым. Именно на это упали e2e: витрина, запущенная руками,
    // пережила `--all` и сломала проверки, рассчитанные на один процесс.
    await clearTransactions();
    for (const id of processIds()) {
      await seedProcess(id);
      console.log(`процесс ${id}: состояние применено`);
    }
  } else if (arg === '--showcase') {
    await seedShowcase();
    console.log('витрина: по строке на каждый этап каждого процесса');
  } else if (arg) {
    await seedProcess(arg);
    console.log(`процесс ${arg}: состояние применено`);
  }

  await pool.end();
}
