import { pool } from '../src/db.ts';
import { seedRefs } from '../db/seed.ts';
import { PROCESSES } from '../src/domain/process-map.ts';
import { cleanArtifacts, json, mark, unmark } from './walkthrough-tools.ts';

// СКВОЗНАЯ ПРОВЕРКА: ПРОЙТИ ВСЕ ПРОЦЕССЫ ВПЕРЁД И ВЕРНУТЬСЯ К НАЧАЛУ.
//
//   bun run verify:walkthrough
//
// ИДЁМ ЧЕРЕЗ ПРИЛОЖЕНИЕ, а не вызовами домена: тогда проверяется то, чем будет пользоваться
// человек — маршрут, права, разметка панели. Вызов `stepAt` напрямую доказал бы, что
// арифметика верна, и ничего не сказал бы о том, работает ли кнопка.
//
// НА КАЖДОМ ШАГЕ СВЕРЯЕТСЯ СОСТОЯНИЕ строки с состоянием шага из карты процессов.
//
// ГРАНИЦЫ ПРОВЕРЯЮТСЯ ОТДЕЛЬНО: на последнем шаге «вперёд» обязано отказать, на первом —
// «назад». Иначе проверка прошла бы по процессу и не заметила, что за его пределами
// движения нет.
//
// СЛЕДЫ УБИРАЮТСЯ — журнал, уведомления, отметки; строки возвращаются на первый шаг.

await seedRefs();

// ОТМЕТКИ СНИМАЮТСЯ ПЕРЕД ПРОВЕРКОЙ. Сдвиг действует на ВСЕ отмеченные строки сразу, и
// чужая отметка (от тестов, от прошлого прогона, от оператора) ломает проверку: в наборе
// оказывается строка ВНЕ процесса, и сдвиг справедливо отказывает.
const foreign = (await pool.query(`update line_mark set marked = false where marked`)).rowCount ?? 0;
console.log(`снято чужих отметок перед проверкой: ${foreign}\n`);

const lines = (await pool.query<{ id: string; process_id: string }>(
  `select id, process_id from line
    where internal_order_number like 'ПРОВ-%' and process_step = 1`)).rows;

if (lines.length === 0) {
  console.error('НЕТ СТРОК ДЛЯ ПРОВЕРКИ. Загрузите сид: bun run db:seed --nodes');
  await pool.end();
  process.exit(1);
}

console.log('СКВОЗНАЯ ПРОВЕРКА: ВПЕРЁД ДО КОНЦА И НАЗАД ДО НАЧАЛА\n');

const since = new Date();
const problems: string[] = [];
const touched: string[] = [];

/** Состояние строки в базе. */
const statusOf = async (id: string): Promise<{ status: string; step: number }> => {
  const r = await pool.query<{ status: string; process_step: number }>(
    `select status, process_step from line where id = $1`, [id]);
  return { status: r.rows[0]!.status, step: r.rows[0]!.process_step };
};

for (const process of PROCESSES) {
  const line = lines.find((l) => l.process_id === process.id);
  if (!line) {
    problems.push(`процесс ${process.id}: нет строки на первом шаге`);
    console.log(`  ${process.id.padStart(14)}: НЕТ СТРОКИ`);
    continue;
  }
  touched.push(line.id);

  // ЧИСТОЕ НАЧАЛО: чужая отметка превратила бы сдвиг в отказ «стоят на разных шагах».
  await pool.query(`update line_mark set marked = false where marked`);

  const last = process.steps.length;
  let failed = false;

  // --- ВПЕРЁД до последнего шага ---
  for (let n = 1; n < last; n++) {
    await mark(line.id);
    const r = await json('/lines/step', { dir: 'next' });
    if (r.status !== 200) {
      problems.push(`процесс ${process.id}, шаг ${n}→${n + 1}: отказ ${r.status}`);
      failed = true;
      break;
    }
    const step = Number(r.body.step);
    // СВЕРКА С КАРТОЙ: состояние после сдвига обязано совпасть с состоянием шага.
    const card = process.steps[step - 1]!;
    const want = card.status ?? process.steps[step - 2]?.status ?? 'new';
    const now = await statusOf(line.id);
    if (now.status !== want) {
      problems.push(`процесс ${process.id}, шаг ${step}: состояние «${now.status}» вместо «${want}»`);
      failed = true;
    }
  }

  // --- ГРАНИЦА: на последнем шаге вперёд нельзя ---
  const atEnd = await statusOf(line.id);
  if (atEnd.step !== last) problems.push(`процесс ${process.id}: дошёл до ${atEnd.step} из ${last}`);
  await mark(line.id);
  const beyond = await json('/lines/step', { dir: 'next' });
  if (beyond.status !== 409) problems.push(`процесс ${process.id}: с последнего шага пустило дальше`);
  // ОТКАЗ ОТМЕТКУ НЕ СНЯЛ — снимаем сами: иначе она дойдёт до следующего процесса.
  await unmark(line.id);

  // --- НАЗАД до первого шага ---
  for (let n = last; n > 1; n--) {
    await mark(line.id);
    const r = await json('/lines/step', { dir: 'prev' });
    if (r.status !== 200) {
      problems.push(`процесс ${process.id}, шаг ${n}→${n - 1}: отказ ${r.status}`);
      failed = true;
      break;
    }
  }

  // --- ГРАНИЦА: на первом шаге назад нельзя ---
  const back = await statusOf(line.id);
  if (back.step !== 1) problems.push(`процесс ${process.id}: вернулся на шаг ${back.step}, а не на 1`);
  await mark(line.id);
  const before = await json('/lines/step', { dir: 'prev' });
  if (before.status !== 409) problems.push(`процесс ${process.id}: с первого шага пустило назад`);
  await unmark(line.id);

  console.log(`  ${process.id.padEnd(16)} шагов ${String(last).padStart(2)}  `
    + `${failed ? 'С ОШИБКАМИ' : 'вперёд до конца и назад'}  ${(process.title ?? '').slice(0, 30)}`);
}

// --- УБОРКА СЛЕДОВ ---
const cleaned = await cleanArtifacts(pool, since, touched);
console.log('\nУБОРКА АРТЕФАКТОВ:');
console.log(`  записей журнала «сдвинул по шагу»: удалено ${cleaned.journal}`);
console.log(`  уведомлений АРМ: удалено ${cleaned.notices}`);
console.log(`  снято отметок: ${cleaned.marks}`);
console.log(`  строк возвращено на первый шаг: ${cleaned.lines}`);

await pool.end();

console.log('');
if (problems.length > 0) {
  console.error('ОТКАЗЫ И РАСХОЖДЕНИЯ:');
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
console.log(`ВСЕ ${PROCESSES.length} ПРОЦЕССОВ ПРОЙДЕНЫ ВПЕРЁД И ВОЗВРАЩЕНЫ К НАЧАЛУ.`);
