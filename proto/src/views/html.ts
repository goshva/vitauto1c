// Каркас HTML и экранирование.
//
// HTMX выбран заказчиком (решение Q2): сервер отдаёт готовые фрагменты, браузер
// их подставляет. Никакого сборщика, никакого состояния на клиенте — то, что
// нельзя собрать в 200 строк на сервере, не должно попадать в АРМ.
//
// Экранирование обязательно: данные приходят из заявок клиентов, где встречаются
// кавычки, угловые скобки и амперсанды. Без экранирования список ломается на первой
// же строке с `<` — в legacy это был реальный дефект.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const esc = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Пустое значение показываем прочерком, а не пустой ячейкой: пустота читается как «нет данных». */
export const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? '<span class="empty">—</span>' : esc(s);
};

export interface LayoutProps {
  title: string;
  /** Содержимое страницы. */
  body: string;
  /** Идентификатор страницы для Playwright. */
  testId: string;
}

export function layout({ title, body, testId }: LayoutProps): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="/static/app.css">
  <script src="/static/htmx.min.js" defer></script>
</head>
<body data-testid="${esc(testId)}">
  <header class="top">
    <h1>${esc(title)}</h1>
    <nav>
      <a href="/lines" data-testid="nav-lines">Строки</a>
      <a href="/supply" data-testid="nav-supply">Снабжение</a>
      <a href="/documents/returns" data-testid="nav-documents">Документы</a>
      <a href="/processes" data-testid="nav-process">Карта процессов</a>
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}
