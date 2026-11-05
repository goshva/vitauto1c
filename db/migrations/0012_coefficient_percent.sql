-- +goose Up
-- Миграция 0012: коэффициент наценки переводится в проценты.
-- Было: цена = база × коэфф (множитель, например 1.3).
-- Стало: цена = себестоимость × (1 + коэфф/100), поэтому коэфф = (c − 1) × 100 (1.3 → 30).
-- Цены (sale_price) НЕ пересчитываются: фиксированные цены сохраняются как есть.
-- Строки без коэффициента (NULL или 0) не трогаем.
update arm.line
   set coefficient = round((coefficient - 1) * 100, 3)
 where coefficient is not null and coefficient <> 0;

-- +goose Down
update arm.line
   set coefficient = round(coefficient / 100 + 1, 3)
 where coefficient is not null and coefficient <> 0;
