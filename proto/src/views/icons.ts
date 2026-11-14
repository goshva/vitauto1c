// Иконки боковой панели: маленькие линейные SVG.
//
// В legacy иконки приходили компонентом `AppIcon` (набор путей в отдельном файле).
// Здесь — тот же приём, но без сборщика: функция возвращает готовый `<svg>`.
//
// Инлайновый SVG, а не шрифт или эмодзи: эмодзи выглядят по-разному в Windows,
// Linux и на печати, а шрифт иконок требует отдельного файла и мигает при загрузке.

const PATHS: Record<string, string> = {
  // Сводка: четыре квадрата.
  summary: '<rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1"/><rect x="9" y="9" width="5.5" height="5.5" rx="1"/>',
  // Строки: список с отметками.
  lines: '<path d="M2 4h2M2 8h2M2 12h2"/><path d="M7 4h7M7 8h7M7 12h7"/>',
  // Снабжение: грузовик.
  supply: '<path d="M1.5 4h8v7h-8z"/><path d="M9.5 7h3l2 2v2h-5z"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="13" r="1.5"/>',
  // Документы: лист с загнутым углом.
  documents: '<path d="M4 1.5h5l3.5 3.5v9.5H4z"/><path d="M9 1.5V5h3.5"/>',
  // Автопарк: машина.
  fleet: '<path d="M2 10l1.5-4.5h9L14 10"/><path d="M1.5 10h13v3h-13z"/><circle cx="4.5" cy="13" r="1.2"/><circle cx="11.5" cy="13" r="1.2"/>',
  // Склад: короб.
  stock: '<path d="M2 5.5l6-3 6 3v6l-6 3-6-3z"/><path d="M2 5.5l6 3 6-3M8 8.5v6"/>',
  // Счета: документ с чертой итога.
  invoices: '<path d="M3.5 1.5h9v13l-2-1.5-2 1.5-2-1.5-2 1.5z"/><path d="M6 5.5h4M6 8.5h4"/>',
  // Карта процессов: слои.
  processes: '<path d="M8 1.5l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3M2 11.5l6 3 6-3"/>',
  // Заказ-наряды и ремонт: гаечный ключ.
  repair: '<path d="M11 2.5a3.5 3.5 0 0 0-3 5.2L3 12.7l1.3 1.3 5-5A3.5 3.5 0 1 0 11 2.5z"/>',
  // Профиль.
  user: '<circle cx="8" cy="5.5" r="2.8"/><path d="M2.5 14.5c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8"/>',
  // Свернуть панель: две вертикальные линии и стрелка влево.
  collapse: '<path d="M2 3v10"/><path d="M13 8H6"/><path d="M9 5l-3 3 3 3"/>',
  // Сменить тему: половина залита — «день и ночь».
  theme: '<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor"/>',
};

/**
 * Иконка по имени. Неизвестное имя даёт пустой контур, а не падение:
 * в панели от неё зависит только вид, и ронять страницу из-за картинки нельзя.
 */
export function icon(name: string): string {
  const d = PATHS[name] ?? '';
  return `<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor"
    stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
