import { z } from '@hono/zod-openapi';

// Отбор по КАЖДОМУ полю списка (ФТ v2 п. 14).
//
// «Рабочее место — один список по всем заказам сразу, колонки как в согласованном
// файле-реестре, панель отбора по каждому полю сверху».
//
// ПОЧЕМУ ОТДЕЛЬНЫМ МОДУЛЕМ. Фильтры — это контракт: их читает и API, и экран, и
// тесты. Разложенные по обработчику, они разошлись бы с панелью на экране, и
// оператор искал бы поле, которого нет, или наоборот.
//
// СОГЛАШЕНИЕ ПО ТЕКСТОВЫМ ФИЛЬТРАМ: подстрока, без учёта регистра (`ilike '%…%'`).
// Оператор ищет «фильтр», а не «Фильтр масляный» целиком. Точное совпадение тут
// было бы вредным: он не помнит написание.

export const LineFilters = z.object({
  view: z.enum(['sales', 'purchases']).optional().default('sales'),
  status: z.string().optional().describe('Состояние строки'),
  /** Номер: наш внутренний, заказа клиента или заказа покупателя — что найдётся. */
  number: z.string().optional().describe('Любой номер: наш, клиента или заказа'),
  name: z.string().optional().describe('Наименование или факт заявки'),
  article: z.string().optional().describe('Наш артикул или код поставщика'),
  clientNumber: z.string().optional().describe('Номер заказа клиента'),
  customer: z.string().optional().describe('Заказчик'),
  supplier: z.string().optional().describe('Поставщик'),
  urgency: z.string().optional().describe('Метка «Срочно»'),
  base: z.string().optional().describe('База (территория)'),
  plate: z.string().optional().describe('Гос. номер'),
  comment: z.string().optional().describe('Комментарий'),
  dateFrom: z.string().optional().describe('Дата заявки, с (ГГГГ-ММ-ДД)'),
  dateTo: z.string().optional().describe('Дата заявки, по (ГГГГ-ММ-ДД)'),
  qtyFrom: z.coerce.number().optional().describe('Количество, от'),
  qtyTo: z.coerce.number().optional().describe('Количество, до'),
  marked: z.enum(['true', 'false']).optional().describe('Только отмеченные'),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  cursor: z.coerce.number().int().min(0).optional().default(0),
});

export type LineFilters = z.infer<typeof LineFilters>;

/** Подстрока без учёта регистра. `%` и `_` в запросе — символы, а не шаблоны. */
const like = (v: string): string => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Собирает условия отбора.
 *
 * Возвращает фрагмент `where` и параметры. Порядок параметров — порядок условий,
 * поэтому нумерация `$n` ведётся по длине массива, а не вписана руками: вписать
 * руками и ошибиться на единицу — классика, и ошибка тут молчаливая.
 */
export function buildFilter(f: LineFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts: string[] = [];

  const eq = (column: string, value: string | undefined): void => {
    if (value === undefined || value === '') return;
    params.push(value);
    parts.push(`${column} = $${params.length}`);
  };
  const sub = (columns: string[], value: string | undefined): void => {
    if (value === undefined || value === '') return;
    params.push(like(value));
    const n = params.length;
    parts.push(`(${columns.map((c) => `${c} ilike $${n}`).join(' or ')})`);
  };
  const cmp = (column: string, op: string, value: number | undefined): void => {
    if (value === undefined) return;
    params.push(value);
    parts.push(`${column} ${op} $${params.length}`);
  };

  eq('operation', f.view === 'sales' ? 'sale' : 'purchase');
  eq('status', f.status);
  // «№» ищет по ВСЕМ номерам сразу: оператор не помнит, какой из трёх у него на бумаге.
  sub(['"order"::text', '"internalOrderNumber"', '"clientOrderNumber"'], f.number);
  sub(['"factName"', '"nomenclature"'], f.name);
  sub(['"nomenclatureArticle"', '"nomenclatureCode"'], f.article);
  sub(['"clientOrderNumber"'], f.clientNumber);
  sub(['customer'], f.customer);
  sub(['supplier'], f.supplier);
  sub(['urgency'], f.urgency);
  sub(['territory'], f.base);
  // Гос. номер лежит в атрибутах машины, а не в строке: ищем по вью.
  sub(['vin', 'plate', 'brand', 'model'], f.plate);
  sub(['comment'], f.comment);

  if (f.dateFrom) {
    params.push(f.dateFrom);
    parts.push(`"orderDate" >= $${params.length}::date`);
  }
  if (f.dateTo) {
    // Включительно: оператор называет последний день, а не «до него».
    params.push(f.dateTo);
    parts.push(`"orderDate" < ($${params.length}::date + 1)`);
  }
  cmp('quantity', '>=', f.qtyFrom);
  cmp('quantity', '<=', f.qtyTo);

  if (f.marked !== undefined) parts.push(`marked = ${f.marked === 'true'}`);

  return { where: parts.length > 0 ? `where ${parts.join(' and ')}` : '', params };
}

/** Сколько условий задано — для подписи на экране. */
export const filterCount = (f: LineFilters): number =>
  Object.entries(f).filter(([k, v]) =>
    !['view', 'limit', 'cursor'].includes(k) && v !== undefined && v !== '').length;
