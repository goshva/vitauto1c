import { parseQuantity, parseUrgent } from './import-numbers.ts';
// Шаблон заявки и разбор вставки из буфера (ФТ v2 п. 8).
//
// «Заявка вставляется из буфера обмена (Ctrl+V) построчно, БЕЗ ПОРЧИ ЧИСЕЛ».
//
// Про «порчу чисел» стоит сказать отдельно, потому что это и есть суть требования.
// Excel в русской локали печатает дробную часть через запятую, а разряды разделяет
// ПРОБЕЛОМ (иногда неразрывным): «1 234,56». Если такой текст разобрать наивно,
// получится 1 (число) и «234,56» (мусор) — или 123456. Ошибка тихая: строка
// создастся, количество будет неверным, и заметят это на складе.
//
// Поэтому единица измерения отделена от количества, а количество разбирается
// отдельной функцией с явными правилами.

export interface ParsedRow {
  /** Номер строки во вставленном тексте — для сообщения об ошибке. */
  line: number;
  name: string;
  article: string | null;
  quantity: string;
  unit: string | null;
  clientNumber: string | null;
  plate: string | null;
  urgent: boolean;
  base: string | null;
}

interface ParseResult {
  rows: ParsedRow[];
  errors: string[];
}

/** Колонки шаблона. Порядок — он же порядок в шапке файла. */
export const COLUMNS = [
  'Наименование', 'Артикул', 'Кол-во', 'Ед.', 'Гос. номер', 'Срочно', 'База',
  '№ заказа',
] as const;

/** Образцы строк. Нужны: по пустому шаблону неясно, что писать в колонки. */
const TEMPLATE_ROWS: string[][] = [
  ['Фильтр масляный', 'FLT-OIL-001', '2', 'шт', 'А123ВС77', 'да', 'Склад на Ленина', 'З-1001'],
  ['Колодки тормозные', 'BRK-FR-001', '1', 'шт', 'А123ВС77', '', 'Склад на Ленина', 'З-1001'],
];

/**
 * Синонимы заголовков колонок.
 *
 * Разбор идёт ПО ИМЕНАМ, а не по позициям, и это не украшательство: в Excel колонки
 * переставляют и переименовывают, а реестр заказчика живёт своей жизнью. Первая
 * версия читала `cells[2]` жёстко — и на файле с другим порядком колонок количество
 * молча становилось пустым, а строки не создавались.
 */
const ALIASES: Record<string, string[]> = {
  name: ['наименование', 'номенклатура', 'позиция', 'товар', 'деталь', 'как написал клиент'],
  article: ['артикул', 'код', 'артикул поставщика'],
  quantity: ['кол-во', 'количество', 'колво', 'qty'],
  unit: ['ед.', 'ед', 'единица', 'единица измерения'],
  plate: ['гос. номер', 'гос номер', 'госномер', 'номер авто', 'номер тс'],
  urgent: ['срочно', 'срочность'],
  base: ['база', 'склад', 'территория'],
  clientNumber: ['№ заказа', 'номер заказа', 'заказ клиента', '№ заказа клиента'],
};

/** Позиция колонки по её названию в шапке. */
const fieldOf = (header: string): string | null => {
  const h = header.trim().toLowerCase();
  for (const [field, names] of Object.entries(ALIASES)) {
    if (names.includes(h)) return field;
  }
  return null;
};

/**
 * Разбирает вставленный текст.
 *
 * Разделитель определяется по первой непустой строке: табуляция (вставка из Excel),
 * точка с запятой (русский CSV) или запятая.
 *
 * Если первая строка — ШАПКА (в ней узнаются названия колонок), столбцы берутся по
 * именам, и порядок может быть любым. Без шапки работает порядок шаблона.
 */
export function parsePasted(text: string): ParseResult {
  const errors: string[] = [];
  const rows: ParsedRow[] = [];

  const raw = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows, errors: ['Пусто: вставьте заполненный шаблон.'] };

  const sample = lines[0]!.includes('\t') ? '\t'
    : lines[0]!.includes(';') ? ';'
      : lines[0]!.includes(',') ? ',' : null;
  if (!sample) {
    return { rows, errors: ['Не вижу колонок: разделитель — табуляция, «;» или «,».'] };
  }

  const cut = (l: string): string[] => l.split(sample).map((c) => c.trim().replace(/^"|"$/g, ''));

  // Шапка или данные в первой строке? Узнаём по названиям колонок.
  const first = cut(lines[0]!);
  const positions = first.map(fieldOf);
  const hasHeader = positions.some((f) => f !== null);
  const start = hasHeader ? 1 : 0;

  // Карта «поле → индекс». Без шапки — порядок шаблона.
  const DEFAULT_ORDER = ['name', 'article', 'quantity', 'unit', 'plate', 'urgent', 'base', 'clientNumber'];
  const at: Record<string, number> = {};
  if (hasHeader) {
    positions.forEach((f, i) => { if (f !== null && at[f] === undefined) at[f] = i; });
  } else {
    DEFAULT_ORDER.forEach((f, i) => { at[f] = i; });
  }

  if (hasHeader && at.quantity === undefined) {
    errors.push('В шапке нет колонки с количеством («Кол-во») — проверьте, что взят шаблон АРМ.');
  }

  const cell = (cells: string[], field: string): string =>
    at[field] === undefined ? '' : (cells[at[field]!] ?? '');

  for (let i = start; i < lines.length; i++) {
    // Номер строки — как в исходном тексте, чтобы человек нашёл её в Excel.
    const lineNo = i + 1;
    const cells = cut(lines[i]!);

    const name = cell(cells, 'name');
    if (name === '') {
      errors.push(`Строка ${lineNo}: пустое наименование — строку пропустил.`);
      continue;
    }

    const quantity = parseQuantity(cell(cells, 'quantity'));
    if (quantity === null) {
      errors.push(`Строка ${lineNo}: количество «${cell(cells, 'quantity')}» не разобрано — строку пропустил.`);
      continue;
    }

    // Поля шапки берём из КАЖДОЙ строки, а не из первой: в реестре их пишут в каждой,
    // и разное «База» у соседних строк — обычное дело.
    rows.push({
      line: lineNo,
      name,
      article: cell(cells, 'article') || null,
      quantity,
      unit: cell(cells, 'unit') || null,
      plate: cell(cells, 'plate') || null,
      urgent: parseUrgent(cell(cells, 'urgent')),
      base: cell(cells, 'base') || null,
      clientNumber: cell(cells, 'clientNumber') || null,
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push('Ни одной строки с наименованием и количеством.');
  }
  return { rows, errors };
}

/** Текст шаблона. Точка с запятой и BOM — чтобы Excel открыл его колонками. */
export function templateText(): string {
  const escape = (v: string): string => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head: string[] = [...COLUMNS];
  return '\uFEFF' + [head, ...TEMPLATE_ROWS]
    .map((row) => row.map(escape).join(';'))
    .join('\r\n') + '\r\n';
}
