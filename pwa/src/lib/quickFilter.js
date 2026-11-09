// Быстрый фильтр по значению ячейки таблицы (двойной клик по значению).
// Сравниваем то же отображение, что видит пользователь: display() из lib/columns.

// Текст значения так, как он показан в ячейке; пустое — ''.
export function cellText(line, field, display) {
  const v = display(line, field);
  return v == null ? '' : String(v).trim();
}

// Совпадает ли строка с быстрым фильтром { field, value }.
// Статус сравниваем по коду (status), остальные поля — по отображаемому тексту.
export function matchesQuick(line, filter, display) {
  if (!filter) return true;
  if (filter.field === 'status') return line.status === filter.value;
  return cellText(line, filter.field, display) === filter.value;
}

// Число на бейдже кнопки «Фильтры»: сколько строк найдено при активных фильтрах.
// Когда фильтров нет — 0 (бейдж не показываем), чтобы не путать с количеством фильтров.
export function filtersBadge(activeCount, shown) {
  return activeCount ? shown : 0;
}

// Подпись кнопки «Фильтры»: активные фильтры + счётчик отфильтрованных строк.
// Счётчик показываем всегда — в том числе когда фильтров нет (сколько строк загружено).
export function filtersAria(activeCount, shown, total) {
  return activeCount
    ? `Фильтры, отфильтровано ${shown} из ${total} строк`
    : `Фильтры, строк ${shown}`;
}
