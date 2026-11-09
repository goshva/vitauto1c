// Быстрый фильтр по значению (двойной клик по ячейке таблицы): чистая логика без DOM.
import { describe, it, expect } from 'vitest';
import { cellText, matchesQuick, filtersAria, filtersBadge } from '../src/lib/quickFilter';

// Подставной display как в lib/columns: для теста достаточно prop-доступа.
const display = (line, field) => {
  if (field === 'status') return line.status;
  const v = field.split('.').reduce((o, k) => (o == null ? o : o[k]), line);
  return v == null ? '' : String(v);
};

const line = { id: 'l1', status: 'prepared', factName: 'Фильтр масляный', quantity: 2, customer: { name: 'ИП Иванов' }, urgency: '' };

describe('быстрый фильтр по значению', () => {
  it('сравнивает текст ячейки', () => {
    expect(matchesQuick(line, { field: 'factName', value: 'Фильтр масляный' }, display)).toBe(true);
    expect(matchesQuick(line, { field: 'factName', value: 'фильтр масляный' }, display)).toBe(false);
    expect(matchesQuick(line, { field: 'factName', value: 'Свеча' }, display)).toBe(false);
  });

  it('числа и ссылки сравниваются по отображению', () => {
    expect(matchesQuick(line, { field: 'quantity', value: '2' }, display)).toBe(true);
    expect(matchesQuick(line, { field: 'customer.name', value: 'ИП Иванов' }, display)).toBe(true);
  });

  it('статус сравнивается по коду, а не по подписи', () => {
    expect(matchesQuick(line, { field: 'status', value: 'prepared' }, display)).toBe(true);
    expect(matchesQuick(line, { field: 'status', value: 'Подготовлено' }, display)).toBe(false);
  });

  it('пустой фильтр пропускает всё, пустое значение ячейки не фильтруется', () => {
    expect(matchesQuick(line, null, display)).toBe(true);
    expect(cellText({ ...line, urgency: '' }, 'urgency', display)).toBe('');
  });

  it('aria-label кнопки «Фильтры» содержит счётчик отфильтрованных', () => {
    expect(filtersAria(0, 166, 166)).toBe('Фильтры, строк 166');
    expect(filtersAria(1, 12, 166)).toBe('Фильтры, отфильтровано 12 из 166 строк');
    expect(filtersAria(2, 0, 166)).toBe('Фильтры, отфильтровано 0 из 166 строк');
  });

  it('бейдж кнопки «Фильтры» — количество найденных строк, а не число фильтров', () => {
    expect(filtersBadge(0, 166)).toBe(0);       // фильтров нет — бейджа нет
    expect(filtersBadge(1, 32)).toBe(32);       // один фильтр, нашлось 32
    expect(filtersBadge(2, 0)).toBe(0);         // фильтры есть, но ничего не найдено
  });
});
