// Дата «сегодня» в часовом поясе устройства (YYYY-MM-DD). toISOString() даёт дату UTC:
// с 00:00 до 03:00 по Москве это вчерашнее число.
export function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
