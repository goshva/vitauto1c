import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { parsePasted, templateText } from '../../src/import-template.ts';
import { parseQuantity } from '../../src/import-numbers.ts';

// ФТ v2 п. 8: «Заявка вставляется из буфера обмена (Ctrl+V) построчно, БЕЗ ПОРЦИ
// ЧИСЕЛ. В шапке документа — поля „Гос. номер“, флажок „Срочно“, поле „База“».
//
// Про «порчу чисел» и написана половина этих тестов. Excel в русской локали печатает
// «1 234,56»: разбери такое наивно — получишь 1 (число) и мусор, или 123456. Ошибка
// ТИХАЯ: строка создастся, количество будет неверным, и заметят это на складе.

const CUSTOMER = '66666666-6666-6666-6666-666666666601';

const uiPost = (url: string, body: Record<string, string>) =>
  app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

const text = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'text/html' } });
  return { status: r.status, body: await r.text(), headers: r.headers };
};

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('№8 · шаблон, который можно заполнить', () => {
  test('шаблон отдаётся ФАЙЛОМ, а не текстом на экране', async () => {
    const r = await app.request('/ui/lines/template');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type') ?? '').toContain('text/csv');
    // Заполняют его в Excel и копируют оттуда: без скачивания шаблон бесполезен.
    expect(r.headers.get('content-disposition') ?? '').toContain('attachment');
  });

  test('в шаблоне есть BOM и точка с запятой — иначе Excel сложит всё в одну колонку', async () => {
    const body = templateText();
    expect(body.charCodeAt(0), 'нет BOM').toBe(0xfeff);
    expect(body.split('\r\n')[0], 'разделитель не «;»').toContain(';');
  });

  test('шапка шаблона называет все колонки, включая «База»', () => {
    const head = templateText().replace(/^\uFEFF/, '').split('\r\n')[0]!;
    for (const col of ['Наименование', 'Артикул', 'Кол-во', 'Ед.', 'Гос. номер', 'Срочно', 'База']) {
      expect(head, `колонки «${col}» нет в шаблоне`).toContain(col);
    }
  });

  test('в шаблоне есть строки-образцы — по пустому непонятно, что писать', () => {
    const lines = templateText().trimEnd().split('\r\n');
    expect(lines.length, 'шаблон без образцов').toBeGreaterThan(1);
    expect(lines[1]).toContain('FLT-OIL-001');
  });

  test('форма вставки показывает образец и ссылку на шаблон', async () => {
    const { status, body } = await text('/ui/lines/paste-form');
    expect(status).toBe(200);
    expect(body).toContain('data-testid="paste-template-link"');
    expect(body).toContain('data-testid="paste-input"');
    expect(body).toContain('data-testid="paste-example-text"');
  });

  test('форма открывается со списка строк', async () => {
    const { body } = await text('/lines');
    expect(body, 'входа в вставку нет в списке').toContain('data-testid="paste-open"');
  });
});

describe('№8 · разбор чисел — «без порчи чисел»', () => {
  test('запятая и точка равнозначны', () => {
    expect(parseQuantity('1,5')).toBe('1.5');
    expect(parseQuantity('1.5')).toBe('1.5');
  });

  test('разряды, разделённые ПРОБЕЛОМ, не ломают число', () => {
    expect(parseQuantity('1 234')).toBe('1234');
    expect(parseQuantity('1 234,56'), '«1 234,56» разобрано неверно').toBe('1234.56');
  });

  test('неразрывный и узкий пробелы тоже разбираются', () => {
    // Excel печатает разряды именно неразрывным пробелом — обычной заменой на « »
    // это не лечится.
    expect(parseQuantity('1\u00a0234,56')).toBe('1234.56');
    expect(parseQuantity('1\u202f234,56')).toBe('1234.56');
  });

  test('«1,234» — это разряды, а не дробь: правило названо явно', () => {
    expect(parseQuantity('1,234')).toBe('1234');
  });

  test('но «1,23» и «1,2345» — дробь', () => {
    expect(parseQuantity('1,23')).toBe('1.23');
    expect(parseQuantity('1,2345')).toBe('1.2345');
  });

  test('несколько разделителей: последний десятичный, остальные разряды', () => {
    expect(parseQuantity('1.234,56')).toBe('1234.56');
    expect(parseQuantity('1,234.56')).toBe('1234.56');
  });

  test('мусор не проходит молча — возвращается null', () => {
    expect(parseQuantity('две штуки')).toBe(null);
    expect(parseQuantity('')).toBe(null);
    expect(parseQuantity('0')).toBe(null); // ноль в заявке — это ошибка ввода
  });

  test('целое без разделителей остаётся целым', () => {
    expect(parseQuantity('25')).toBe('25');
  });
});

describe('№8 · разбор вставленного текста', () => {
  const TEMPLATE = templateText();

  test('шапка РАСПОЗНАЁТСЯ и пропускается — вставляют шаблон целиком', () => {
    const { rows, errors } = parsePasted(TEMPLATE);
    expect(errors, 'на шаблоне есть ошибки').toEqual([]);
    expect(rows.length, 'образцы не разобрались').toBe(2);
  });

  test('табуляция из Excel разбирается так же, как «;»', () => {
    const tsv = 'Наименование\tАртикул\tКол-во\tЕд.\tГос. номер\tСрочно\tБаза\t№ заказа\n'
      + 'Фильтр масляный\tFLT-OIL-001\t2\tшт\tА123ВС77\tда\tСклад\tЗ-1';
    const { rows, errors } = parsePasted(tsv);
    expect(errors).toEqual([]);
    expect(rows[0]!.name).toBe('Фильтр масляный');
    expect(rows[0]!.quantity).toBe('2');
  });

  test('шапка шаблона БЕЗ колонки «Кол-во» вызывает предупреждение', () => {
    const { errors } = parsePasted('Наименование;Артикул\nФильтр;FLT-1');
    expect(errors.join(' '), 'чужой файл принят за шаблон АРМ').toContain('Кол-во');
  });

  test('плохая строка названа своим НОМЕРОМ — человек найдёт её в Excel', () => {
    const bad = 'Наименование;Кол-во\nФильтр;2\nКолодки;две штуки';
    const { rows, errors } = parsePasted(bad);
    expect(rows.length).toBe(1);
    expect(errors.join(' ')).toContain('Строка 3');
  });

  test('пустая строка не считается ошибкой', () => {
    // Порядок колонок шаблона: наименование, артикул, количество.
    const { rows, errors } = parsePasted('Фильтр;;2\n\n\nКолодки;;1');
    expect(errors).toEqual([]);
    expect(rows.length).toBe(2);
  });

  test('«да», «+» и «1» означают срочность; пусто и «нет» — нет', () => {
    // Порядок шаблона: наименование, артикул, кол-во, ед., гос. номер, срочно.
    // Считаем разделители: между «1» и «да» их ТРИ, а не четыре — иначе срочность
    // уезжает в пустую колонку «база». Ошибка ровно на один символ.
    const mk = (v: string) => parsePasted(`Фильтр;;1;;;${v}`).rows[0]!.urgent;
    expect(mk('да')).toBe(true);
    expect(mk('+')).toBe(true);
    expect(mk('1')).toBe(true);
    expect(mk('')).toBe(false);
    expect(mk('нет')).toBe(false);
  });

  test('BOM в начале вставленного текста не мешает', () => {
    const { rows } = parsePasted('\uFEFF' + TEMPLATE);
    expect(rows.length).toBe(2);
  });
});

describe('№8 · вставка создаёт заказ', () => {
  test('заказ и строки создаются, поля шапки попадают в строки', async () => {
    const pasted = 'Наименование;Артикул;Кол-во;Ед.;Гос. номер;Срочно;База;№ заказа\n'
      + 'Фильтр масляный;FLT-OIL-001;2;шт;А123ВС77;да;Склад на Ленина;З-1001';

    const r = await uiPost('/ui/lines/paste', { pasted, customerId: CUSTOMER });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('data-testid="paste-done"');

    const line = await pool.query<{
      quantity: string; urgency: string | null; territory: string | null; status: string;
    }>(`select quantity::text, urgency, territory, status from line
          where internal_order_number like 'ВИТ-ЗК-%' order by created_at desc limit 1`);

    expect(line.rows[0]!.status).toBe('новый'.replace('новый', 'new'));
    expect(line.rows[0]!.quantity, 'количество испорчено').toBe('2.00');
    expect(line.rows[0]!.urgency, '«Срочно» не попало в строку').toBe('Срочно');
    expect(line.rows[0]!.territory, '«База» не попала в строку').toBe('Склад на Ленина');

    // Гос. номер — в факте заявки: он относится к машине, а не к позиции.
    //
    // Ищем факт ПО СВОЕЙ строке, а не «последний»: `id` — случайный UUID, и
    // `order by id desc` даёт произвольную строку, а не свежую. Первая версия теста
    // так и ошиблась — прочитала факт из сида и увидела чужой номер.
    const fact = await pool.query<{ vehicle_plate: string | null }>(
      `select f.vehicle_plate
         from line_fact f
         join line l on l.id = f.id
        where l.internal_order_number like 'ВИТ-ЗК-%'`);
    expect(fact.rows[0]!.vehicle_plate, '«Гос. номер» потерян').toBe('А123ВС77');
  });

  test('число из Excel не портится: «1 234,56» доходит как 1234.56', async () => {
    const pasted = 'Наименование;Кол-во\nМасло моторное;1\u00a0234,56';
    await uiPost('/ui/lines/paste', { pasted, customerId: CUSTOMER });

    const r = await pool.query<{ quantity: string }>(
      `select quantity::text from line order by created_at desc limit 1`);
    expect(r.rows[0]!.quantity, 'число испорчено при вставке').toBe('1234.56');
  });

  test('несколько строк — один заказ', async () => {
    const before = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from customer_order`)).rows[0]!.n);

    const pasted = 'Наименование;Кол-во\nФильтр;2\nКолодки;1\nСвеча;4';
    await uiPost('/ui/lines/paste', { pasted, customerId: CUSTOMER });

    const after = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from customer_order`)).rows[0]!.n);
    expect(after, 'на каждую строку создался свой заказ').toBe(before + 1);
  });

  test('позиция сопоставляется с номенклатурой по артикулу', async () => {
    const pasted = 'Наименование;Артикул;Кол-во\nЧто угодно;FLT-OIL-001;1';
    await uiPost('/ui/lines/paste', { pasted, customerId: CUSTOMER });

    const r = await pool.query<{ nomenclature_id: string | null }>(
      `select nomenclature_id from line order by created_at desc limit 1`);
    // Опозналась по артикулу, хотя наименование написано «как угодно».
    expect(r.rows[0]!.nomenclature_id, 'позиция не сопоставилась по артикулу').toBeTruthy();
  });

  test('плохая строка не создаёт заказ, и причина названа', async () => {
    const before = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from customer_order`)).rows[0]!.n);

    const r = await uiPost('/ui/lines/paste', {
      pasted: 'Наименование;Кол-во\nКолодки;две штуки', customerId: CUSTOMER,
    });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('data-testid="paste-errors"');

    const after = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from customer_order`)).rows[0]!.n);
    expect(after, 'заказ создан из мусора').toBe(before);
  });

  test('пустая вставка объясняется словами', async () => {
    const r = await uiPost('/ui/lines/paste', { pasted: '', customerId: CUSTOMER });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('Пусто');
  });
});

describe('№8 · строки заявки не ломают существующие', () => {
  test('загруженные строки видны в списке', async () => {
    const pasted = 'Наименование;Артикул;Кол-во\nФильтр масляный;FLT-OIL-001;2';
    await uiPost('/ui/lines/paste', { pasted, customerId: CUSTOMER });

    const { body } = await text('/lines');
    expect(body, 'загруженной строки нет в списке').toContain('Фильтр масляный');
  });

  test('неопознанная позиция попадает в неопознанные', async () => {
    const pasted = 'Наименование;Артикул;Кол-во\nСтранная деталь;НЕТ-ТАКОГО;1';
    await uiPost('/ui/lines/paste', { pasted, customerId: CUSTOMER });

    const { body } = await text('/unidentified');
    expect(body, 'неопознанная позиция не попала на свой экран').toContain('Странная деталь');
  });
});
