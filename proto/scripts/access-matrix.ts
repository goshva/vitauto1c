import { app } from '../src/server.ts';
import { pool } from '../src/db.ts';
import { encodeSession } from '../src/session.ts';
import { writeFileSync } from 'node:fs';
import { ROLES as ROLE_SPECS } from '../src/domain/roles.ts';
import { isAllowed } from '../src/domain/access.ts';
import { isHidden } from '../src/domain/columns.ts';

// СПИСОК РОЛЕЙ берётся из `roles.ts` — там он несёт подписи и используется экранами.
// `ROLES` там ОБЪЕКТ (роль → подпись), а не массив: идентификаторы даёт `Object.keys`.
const ROLES: string[] = Object.keys(ROLE_SPECS);

/**
 * ДЕЙСТВИЯ — списком здесь, потому что в коде они существуют только как ТИП.
 *
 * Тип `Action` на этапе выполнения не существует, и перечислить его нельзя. Список выписан
 * руками — и это слабое место: добавив действие в код, его легко забыть здесь. Поэтому
 * у списка есть проверка: тест сверяет, что каждое действие из этого списка известно
 * `isAllowed`, а число действий совпадает с объявленным в `access.ts`.
 */
const ACTIONS = [
  'dashboard.view', 'request.create', 'request.view', 'work.execute', 'stock.issue',
  'fleet.edit', 'invoice.manage', 'data.delete', 'purchase.create', 'return.create',
  'audit.read', 'job.run', 'report.cost',
] as const;

// МАТРИЦА ДОСТУПА: ПО КОДУ И ПО ФАКТУ.
//
//   bun run scripts/access-matrix.ts            — показать
//   bun run scripts/access-matrix.ts --write    — записать в docs/access-matrix.md
//
// ДВЕ ЧАСТИ, И ОБЕ НУЖНЫ.
//
// «ПО КОДУ» — что заявлено: какие действия кому разрешены (`access.ts`), какие колонки
// закрыты (`columns.ts`). Это НАМЕРЕНИЕ.
//
// «ПО ФАКТУ» — что происходит: каждая роль ЗАПРАШИВАЕТ каждую вкладку, и записывается код
// ответа. Это ДЕЙСТВИТЕЛЬНОСТЬ. Расхождение между ними и есть дефект: заявленное право не
// работает или, что хуже, работает без заявления.
//
// ПОЧЕМУ ЗАПРОСОМ, А НЕ ЧТЕНИЕМ ОХРАН. Читая код, я повторяю ту же ошибку, что и в нём:
// вижу `guard(...)` там, где его нет, и не вижу там, где он спрятан в middleware. Запрос
// отвечает независимо от того, как это устроено внутри.

/** Вкладки боковой панели: подпись и адрес — из разметки навигации. */
const TABS = [
  { title: 'Сводка', url: '/', testId: 'nav-dashboard' },
  { title: 'Строки', url: '/lines', testId: 'nav-lines' },
  { title: 'Снабжение', url: '/supply', testId: 'nav-supply' },
  { title: 'Документы', url: '/documents/returns', testId: 'nav-documents' },
  { title: 'Автопарк', url: '/fleet', testId: 'nav-fleet' },
  { title: 'Склад', url: '/stock', testId: 'nav-stock' },
  { title: 'Неопознанные', url: '/unidentified', testId: 'nav-unidentified' },
  { title: 'Счета', url: '/invoices', testId: 'nav-invoices' },
  { title: 'Карта процессов', url: '/processes', testId: 'nav-process' },
];

/** Учётные записи: логин совпадает с ролью, кроме кладовщика. */
const LOGIN: Record<string, string> = {
  admin: '11111111-aaaa-1111-1111-111111111101',
  manager: '11111111-aaaa-1111-1111-111111111102',
  storekeeper: '11111111-aaaa-1111-1111-111111111103',
  mechanic: '11111111-aaaa-1111-1111-111111111104',
  municipality: '11111111-aaaa-1111-1111-111111111105',
};

/** Код ответа на запрос вкладки под ролью. 200 — открыта, 403 — закрыта. */
async function openFor(role: string, url: string): Promise<number> {
  const userId = LOGIN[role];
  if (!userId) return 0;
  const r = await app.request(url, {
    headers: { accept: 'text/html', cookie: `arm_session=${encodeSession({ userId, role })}` },
  });
  return r.status;
}

const rows: { role: string; url: string; title: string; status: number }[] = [];
for (const role of ROLES) {
  for (const tab of TABS) {
    rows.push({ role, url: tab.url, title: tab.title, status: await openFor(role, tab.url) });
  }
}
// ПУЛ ЗАКРЫВАЕТСЯ В КОНЦЕ, А НЕ ЗДЕСЬ.
//
// Первая версия закрывала его сразу после этого цикла — и раздел 5 («что открыто без входа»)
// получил «Cannot use a pool after calling end on the pool»: запросы к приложению идут через
// ту же базу. В отчёте это выглядело как 500 у ВСЕХ вкладок, то есть как «всё закрыто», —
// ровно наоборот тому, что есть.

// --- Сборка отчёта ---------------------------------------------------------------------
const out: string[] = [];
const mark = (s: number): string => (s === 200 ? 'да' : s === 403 ? 'НЕТ' : `?${s}`);

out.push('# Матрица доступа: по коду и по факту\n');
out.push('Сгенерировано `scripts/access-matrix.ts`. Править руками бесполезно — перезапишется.\n');

out.push('## 1. Вкладки: что происходит НА САМОМ ДЕЛЕ\n');
out.push('Каждая роль запрашивает каждую вкладку; записан код ответа.\n');
out.push('| Вкладка | ' + [...ROLES].join(' | ') + ' |');
out.push('|---|' + ROLES.map(() => '---').join('|') + '|');
for (const tab of TABS) {
  const cells = ROLES.map((role) => {
    const r = rows.find((x) => x.role === role && x.url === tab.url);
    return mark(r?.status ?? 0);
  });
  out.push(`| ${tab.title} (\`${tab.url}\`) | ${cells.join(' | ')} |`);
}
out.push('\n«да» — 200, «НЕТ» — 403.\n');

const openCount = rows.filter((r) => r.status === 200).length;
const closedCount = rows.filter((r) => r.status === 403).length;
out.push(`Открыто: ${openCount} из ${rows.length}, закрыто: ${closedCount}.\n`);

out.push('## 2. Действия: что ЗАЯВЛЕНО в коде\n');
out.push('| Действие | ' + ROLES.join(' | ') + ' |');
out.push('|---|' + ROLES.map(() => '---').join('|') + '|');
for (const action of ACTIONS) {
  const cells = ROLES.map((role) => (isAllowed(role, action) ? 'да' : '—'));
  out.push(`| \`${action}\` | ${cells.join(' | ')} |`);
}
out.push('');

out.push('## 3. Закрытые колонки: что роль НЕ видит\n');
out.push('| Поле | ' + ROLES.join(' | ') + ' |');
out.push('|---|' + ROLES.map(() => '---').join('|') + '|');
for (const field of ['costPrice', 'costSum', 'salePrice', 'price', 'total']) {
  const cells = ROLES.map((role) => (isHidden(role, field) ? 'НЕ ВИДИТ' : 'видит'));
  out.push(`| \`${field}\` | ${cells.join(' | ')} |`);
}
out.push('');

out.push('## 4. Расхождения «заявлено — фактически»\n');
const mismatches: string[] = [];
for (const role of ROLES) {
  // Администратору открыто всё — это требование, а не пожелание.
  if (role === 'admin') {
    const closed = rows.filter((r) => r.role === role && r.status !== 200);
    if (closed.length > 0) {
      mismatches.push(`admin: закрыто ${closed.length} вкладок — а администратор видит всё`);
    }
  }
}
// Вкладки, открытые ВСЕМ: это не ошибка сама по себе, но должно быть видно.
const openToAll = TABS.filter((tab) =>
  ROLES.every((role) => rows.find((r) => r.role === role && r.url === tab.url)?.status === 200));

out.push(`Вкладок, открытых ВСЕМ ролям: ${openToAll.length} из ${TABS.length}`);
for (const t of openToAll) out.push(`  · ${t.title} (\`${t.url}\`)`);
out.push('');
if (mismatches.length === 0) out.push('Расхождений по администратору нет.');
else for (const m of mismatches) out.push(`· ${m}`);

// --- 5. ДЫРЫ: что открыто тому, кто НЕ ВОШЁЛ ------------------------------------------
//
// Проверка добавлена после того, как вопрос задали: «проверь доступность вкладок».
// Оказалось, что экраны открываются и БЕЗ сессии, а `/lines` в виде JSON отдаёт данные.
//
// ЭТО НЕ ОФОРМЛЕНИЕ СПИСКА, А ЗАПИСЬ НАЙДЕННОГО. Пока дыра не закрыта, о ней надо знать;
// когда закроют — матрица изменится, и это увидят.
out.push('\n## 5. Без входа: что открыто\n');
const anon: { url: string; title: string; html: number; json: number }[] = [];
for (const tab of TABS) {
  const html = await app.request(tab.url, { headers: { accept: 'text/html' } });
  const json = await app.request(tab.url, { headers: { accept: 'application/json' } });
  anon.push({ url: tab.url, title: tab.title, html: html.status, json: json.status });
}
out.push('| Вкладка | страница | данные |');
out.push('|---|---|---|');
for (const a of anon) out.push(`| ${a.title} (\`${a.url}\`) | ${a.html} | ${a.json} |`);
const dataOpen = anon.filter((a) => a.json === 200);
out.push(`\nДанные без входа отдаются у ${dataOpen.length} вкладок из ${TABS.length}.`);
if (dataOpen.length > 0) {
  out.push('ЭТО ДЫРА: ограничение по ролям обходится отсутствием сессии —');
  out.push('кладовщику себестоимость закрыта, а тому, кто просто не вошёл, открыта.');
  out.push('Обязательный вход для API — решение заказчика, а не правка по ходу:');
  out.push('прототип показывают по прямой ссылке, и «сначала войдите» меняет порядок показа.');
}

const text = out.join('\n');
if (process.argv.includes('--write')) {
  writeFileSync('docs/access-matrix.md', text + '\n', 'utf8');
  console.log('записано: docs/access-matrix.md');
} else {
  console.log(text);
}

// Пул закрывается ПОСЛЕ всех запросов — и ролевых, и анонимных.
await pool.end();
