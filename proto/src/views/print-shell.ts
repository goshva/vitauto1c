import { esc } from './html.ts';

// Оболочка печатных форм ремонта: стили и форматирование.
//
// Стили взяты из legacy-формы (`backend/internal/arm/work_order.html.tmpl`):
// Arial 10pt, поля 12 мм, рамки у таблиц, `page-break-after` для нескольких
// документов в одном файле. Переносить форму «по названию», забыв про печатные
// стили, значит получить экранную вёрстку на бумаге.

/**
 * Оболочка страницы.
 *
 * `nowrap` у числовых ячеек обязателен: суммы разделяются пробелами, и без запрета
 * переноса «4 050» может разорваться между строками прямо в печатной форме.
 */
export function printShell(title: string, testId: string, body: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10pt; margin: 12mm; color: #000; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  h1 { font-size: 14pt; margin: 0 0 4mm; }
  h2 { font-size: 11pt; margin: 4mm 0 1mm; }
  p { margin: 0 0 1.5mm; }
  table { width: 100%; border-collapse: collapse; margin: 4mm 0 2mm; font-size: 9pt; }
  th, td { border: 1px solid #000; padding: 1mm 1.5mm; vertical-align: top; }
  th { font-weight: bold; text-align: center; }
  td.n { text-align: right; white-space: nowrap; }
  .total { font-weight: bold; margin-bottom: 2mm; }
  .grand { font-weight: bold; font-size: 11pt; margin-bottom: 6mm; }
  .sign { margin-bottom: 6mm; }
  .req { margin-bottom: 2mm; }
  .muted { color: #444; }
</style></head>
<body data-testid="${esc(testId)}">
<div class="page">
${body}
</div>
</body></html>`;
}

/**
 * Деньги: разряды разделяются ОБЫЧНЫМ пробелом, а не неразрывным.
 *
 * Неразрывный пробел (U+00A0) — обычный вывод `toLocaleString('ru-RU')`. Он хорош
 * для экрана, но делает значение неотличимым от «4 050» в отчётах и тестах, где
 * пробел обычный. Запрет переноса обеспечивает `white-space: nowrap` в стилях —
 * это надёжнее и не прячет символ в разметке.
 */
export const money = (v: number): string =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    .replace(/\u00a0/g, ' ');

/** Количество и нормо-часы: до трёх знаков, тоже с обычным пробелом. */
export const qty = (v: string | number): string =>
  Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 3 }).replace(/\u00a0/g, ' ');

/** Дата в формате документа: 14.11.2026. */
export const docDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};
