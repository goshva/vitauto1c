// Точка входа схемы для drizzle-kit. Каждая предметная область — свой файл
// (prototype-spec.md §2.1: имя файла = то, что он делает; ≤ 200 строк и ≤ 5 экспортов).
//
// Представления (`stock_balance`, `line_totals`, `line_view`) здесь НЕ объявлены:
// drizzle-kit 0.31.11 не умеет генерировать `pgView().as(sql\`…\`)` — падает с
// «qb.getSelectedFields is not a function». Они создаются SQL-миграцией `0006`.
// Для производных объектов это законно: схема владеет таблицами, представления
// считают поверх них.
export * from './line.ts';
export * from './doc.ts';
export * from './work.ts';
export * from './ref.ts';
export * from './ref-stock.ts';
export * from './ref-auto.ts';
export * from './stock.ts';
export * from './idempotency.ts';
