import { describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedRefs } from '../../db/seed.ts';
import { encodeSession } from '../../src/session.ts';
import { ROLES as ROLE_SPECS } from '../../src/domain/roles.ts';
import { NAV } from '../../src/views/nav.ts';

// ДОСТУП К ВКЛАДКАМ: ЧТО ЗАЯВЛЕНО И ЧТО ПРОИСХОДИТ.
//
// ДВЕ ЧАСТИ, И ОБЕ НУЖНЫ.
//
// «ЗАЯВЛЕНО» — список разделов в разметке: у кого есть пометка `data-role-only`, тот
// ограничен. Это НАМЕРЕНИЕ.
//
// «ПРОИСХОДИТ» — каждая роль ЗАПРАШИВАЕТ каждую вкладку, и записывается код ответа. Это
// ДЕЙСТВИТЕЛЬНОСТЬ. Расхождение и есть дефект: заявленное право не работает или, что хуже,
// работает без заявления.
//
// ПОЧЕМУ ЗАПРОСОМ, А НЕ ЧТЕНИЕМ ОХРАН. Читая код, я повторяю ту же ошибку, что и в нём:
// вижу проверку там, где её нет, и не вижу там, где она спрятана. Запрос отвечает
// независимо от того, как это устроено внутри.

const LOGIN: Record<string, string> = {
  admin: '11111111-aaaa-1111-1111-111111111101',
  manager: '11111111-aaaa-1111-1111-111111111102',
  storekeeper: '11111111-aaaa-1111-1111-111111111103',
  mechanic: '11111111-aaaa-1111-1111-111111111104',
  municipality: '11111111-aaaa-1111-1111-111111111105',
};

const ROLES = Object.keys(ROLE_SPECS);

/** Код ответа на запрос вкладки под ролью. */
async function openFor(role: string, url: string): Promise<number> {
  const userId = LOGIN[role];
  if (!userId) return 0;
  const r = await app.request(url, {
    headers: { accept: 'text/html', cookie: `arm_session=${encodeSession({ userId, role })}` },
  });
  return r.status;
}

await seedRefs();

describe('вкладки: заявлено в разметке', () => {
  test('в панели девять разделов', () => {
    expect(NAV.length, 'разделов не девять').toBe(9);
  });

  test('ОГРАНИЧЕН ОДИН — «Сводка», и только администратору', () => {
    // Это НАМЕРЕНИЕ, и оно должно быть видно списком, а не флагом: по списку понятно, кому
    // пункт положен.
    const limited = NAV.filter((n) => n.roles);
    expect(limited.length, 'ограниченных разделов не один').toBe(1);
    expect(limited[0]!.key).toBe('dashboard');
    expect([...limited[0]!.roles!]).toEqual(['admin']);
  });

  test('остальные восемь открыты всем — и это открытый вопрос, а не решение', () => {
    // Правила доступа к ЭКРАНАМ в эталоне нет вовсе: там про права на колонки. Поэтому
    // список описывает то, что есть. Тест держит факт на виду: если кто-то ограничит
    // раздел, это заметят.
    const open = NAV.filter((n) => !n.roles).map((n) => n.key);
    expect(open.length, 'открытых разделов не восемь').toBe(8);
    expect(open).toContain('lines');
    expect(open).toContain('stock');
  });

  test('у каждого раздела есть адрес, подпись и идентификатор для проверки', () => {
    for (const n of NAV) {
      expect(n.href, `${n.key}: нет адреса`).toMatch(/^\//);
      expect(n.title.length, `${n.key}: пустая подпись`).toBeGreaterThan(1);
      expect(n.testId, `${n.key}: нет идентификатора`).toMatch(/^nav-/);
    }
  });
});

describe('вкладки: что происходит на самом деле', () => {
  test('«Сводка» открыта администратору и закрыта остальным', async () => {
    expect(await openFor('admin', '/'), 'администратору сводка закрыта').toBe(200);
    for (const role of ROLES.filter((r) => r !== 'admin')) {
      expect(await openFor(role, '/'), `${role} открыл сводку`).toBe(403);
    }
  });

  test('остальные восемь вкладок открыты ВСЕМ ролям — факт зафиксирован', async () => {
    // Это не «правильно», это «так есть». Тест нужен, чтобы факт не разошёлся с матрицей
    // `docs/access-matrix.md`: если раздел закроют, тест об этом скажет, и матрицу
    // перегенерируют.
    const tabs = NAV.filter((n) => !n.roles);
    for (const tab of tabs) {
      for (const role of ROLES) {
        expect(await openFor(role, tab.href), `${role}: ${tab.title} не открылась`).toBe(200);
      }
    }
  });

  test('БЕЗ ВХОДА вкладки ОТКРЫВАЮТСЯ — это факт, и он зафиксирован', async () => {
    // ПРОВЕРКА ПОКАЗАЛА: экраны не закрыты от запроса без сессии. Это НЕ то, чего хочется,
    // но это то, что есть, и прятать факт за проверкой «должно быть 403» нельзя.
    //
    // ЧТО ЭТО ЗНАЧИТ НА ПРАКТИКЕ. Разметка отдаётся, роль в ней пустая («…» в меню), и
    // данные в API закрыты: без сессии `actorOf` не даёт ни роли, ни прав. То есть экран
    // открывается ПУСТЫМ, а не показывает чужие данные.
    //
    // ЧТО ЭТО ЗНАЧИТ ДЛЯ ЗАКАЗЧИКА. Правило доступа к ЭКРАНАМ в эталоне не задано — там про
    // права на колонки. Нужен ли вход обязательным для всех экранов — вопрос к нему, и он
    // записан в `docs/access-matrix.md`.
    for (const tab of NAV) {
      const r = await app.request(tab.href, { headers: { accept: 'text/html' } });
      expect(r.status, `${tab.title}: экран повёл себя не так, как записано в матрице`)
        .toBe(200);
    }
  });

  test('ДЫРА: данные без входа тоже отдаются — это НАЙДЕННЫЙ ДЕФЕКТ', async () => {
    // ЭТО НЕ ОПИСАНИЕ ЖЕЛАЕМОГО, А ЗАПИСЬ НАЙДЕННОГО ДЕФЕКТА.
    //
    // Проверка показала: `/lines` отдаёт JSON без сессии. То есть прочитать строки заказов
    // может любой, кто знает адрес. Роль в этом случае пустая, но данные приходят.
    //
    // ЧЕМ ЭТО ОПАСНО. Ограничение по ролям обходится ОТСУТСТВИЕМ сессии: кладовщику
    // себестоимость закрыта, а тому, кто просто не вошёл, — открыта.
    //
    // ПОЧЕМУ НЕ ИСПРАВЛЕНО ЗДЕСЬ. Обязательный вход для API — решение заказчика, а не
    // правка по ходу: прототип открывают по прямой ссылке при показе, и «сначала войдите»
    // меняет порядок демонстрации. Вопрос записан в `docs/access-matrix.md`.
    //
    // Тест держит факт на виду: если вход сделают обязательным, он упадёт и напомнит
    // перегенерировать матрицу.
    const r = await app.request('/lines', { headers: { accept: 'application/json' } });
    expect(r.status, 'поведение изменилось — обновите матрицу в docs/access-matrix.md')
      .toBe(200);
  });
});

describe('закрытые колонки: что есть в реестре на самом деле', () => {
  test('в реестре НЕТ колонок себестоимости — прятать нечего', async () => {
    // ЭТО НАЙДЕНО ПРОВЕРКОЙ, И ЭТО ВАЖНО ПОНИМАТЬ ПРАВИЛЬНО.
    //
    // Я считал, что колонки «Цена» и «Сумма» в реестре — это себестоимость, и закрывал их
    // для кладовщика. Проверка показала: они показывают ЦЕНУ ПРОДАЖИ, а её ФТ v2 п. 5
    // кладовщику не запрещает — там сказано «цены закупки и себестоимость». Колонок
    // себестоимости в реестре нет вовсе, и закрывать в нём нечего.
    //
    // Закрытые поля живут в API: `costPrice`, `costSum`, `total`, `price`. Это проверяется
    // отдельно — в `tests/unit/roles-reference.test.ts`.
    const r = await app.request('/lines', {
      headers: {
        accept: 'text/html',
        cookie: `arm_session=${encodeSession({
          userId: LOGIN.storekeeper!, role: 'storekeeper' })}`,
      },
    });
    const html = await r.text();
    const head = /<thead>[\s\S]*?<\/thead>/.exec(html)?.[0] ?? '';

    // ЦЕНА ПРОДАЖИ видна — так решено, и это записано как решение, а не как недосмотр.
    expect(head, 'колонка «Цена» пропала').toContain('>Цена<');
    // А СЕБЕСТОИМОСТИ в шапке нет ни у кого: колонки такой не существует.
    expect(head, 'в реестре появилась колонка себестоимости').not.toContain('Себестоимость');
  });

  test('ЦЕНА ПРОДАЖИ видна всем ролям — это решение, а не недосмотр', async () => {
    // Если заказчик захочет закрыть и её — это ОТДЕЛЬНОЕ решение, и его надо получить
    // явно. Расширять запрет шире написанного в ФТ нельзя: кладовщик выписывает
    // отгрузочные документы, и цена продажи в них есть.
    for (const role of ROLES) {
      const r = await app.request('/lines', {
        headers: {
          accept: 'text/html',
          cookie: `arm_session=${encodeSession({ userId: LOGIN[role]!, role })}`,
        },
      });
      const head = /<thead>[\s\S]*?<\/thead>/.exec(await r.text())?.[0] ?? '';
      expect(head, `${role}: колонка «Цена» пропала`).toContain('>Цена<');
    }
  });

  test('ЧИСЛО КОЛОНОК В ЗАГОЛОВКЕ И В СТРОКЕ СОВПАДАЕТ', async () => {
    // Иначе таблица поедет: подписи сдвинутся относительно ячеек, и это заметят глазами,
    // а не проверкой.
    //
    // СЧИТАЕМ `<th` С ПРОБЕЛОМ ИЛИ ЗАКРЫВАЮЩЕЙ СКОБКОЙ, а не просто `<th`: шаблон `<th`
    // совпадает и с `<thead`, и первая версия проверки считала лишнюю колонку. Ошибка была
    // в проверке, а не в разметке.
    for (const role of ROLES) {
      const r = await app.request('/lines', {
        headers: {
          accept: 'text/html',
          cookie: `arm_session=${encodeSession({ userId: LOGIN[role]!, role })}`,
        },
      });
      const html = await r.text();
      const head = /<thead>[\s\S]*?<\/thead>/.exec(html)?.[0] ?? '';
      const body = /<tbody id="lines-body"[\s\S]*?<\/tbody>/.exec(html)?.[0] ?? '';
      const headCols = (head.match(/<th[ >]/g) ?? []).length;
      const firstRow = /<tr class="line-row"[\s\S]*?<\/tr>/.exec(body)?.[0] ?? '';
      if (firstRow === '') continue;   // строк нет — сверять нечего
      const rowCols = (firstRow.match(/<td/g) ?? []).length;
      expect(rowCols, `${role}: в заголовке ${headCols} колонок, в строке ${rowCols}`)
        .toBe(headCols);
    }
  });
});
