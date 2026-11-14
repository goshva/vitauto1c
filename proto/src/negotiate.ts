import type { Context } from 'hono';

// Согласование формата ответа: один и тот же адрес отдаёт HTML браузеру и JSON агенту.
//
// ПОЧЕМУ `Accept`, а не отдельный префикс `/ui`: адрес `/fleet` — это адрес экрана,
// и он должен остаться им. Браузер просит `text/html` и получает страницу, агент
// просит `application/json` (или не просит ничего) и получает данные. Второй адрес
// для того же ресурса разошёлся бы с первым — как в legacy разошлись `index.html`
// и `arm.line_api`.
//
// Вынесено из `lines-ui.ts` в отдельный модуль: теперь этим пользуются автопарк,
// счета и строки, и держать общий механизм в экране строк неправильно.

/** Клиент просит HTML? HTMX всегда добавляет `HX-Request`. */
export function wantsHtml(c: Context): boolean {
  if (c.req.header('hx-request')) return true;
  return (c.req.header('accept') ?? '').includes('text/html');
}
