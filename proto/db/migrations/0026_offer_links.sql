-- Ссылки на справочники для предложений поставщиков (ФТ v2 п. 12).
--
-- Без них это висячие UUID — ровно то, чем был brand_id до этой недели. Ошибку
-- «поставщик удалён, а предложение осталось» должен ловить не глаз, а база.

ALTER TABLE supplier_offer
  ADD CONSTRAINT supplier_offer_nomenclature_fk
  FOREIGN KEY (nomenclature_id) REFERENCES nomenclature(id) ON DELETE CASCADE;

ALTER TABLE supplier_offer
  ADD CONSTRAINT supplier_offer_supplier_fk
  FOREIGN KEY (supplier_id) REFERENCES counterparty(id) ON DELETE CASCADE;

-- Выбранный вариант в строке. SET NULL: предложение устаревает и его убирают, а
-- строка при этом жива — цена из него УЖЕ перенесена в cost_price.
ALTER TABLE line
  ADD CONSTRAINT line_supplier_offer_fk
  FOREIGN KEY (supplier_offer_id) REFERENCES supplier_offer(id) ON DELETE SET NULL;

-- Цена не может быть отрицательной, срок — тоже.
ALTER TABLE supplier_offer
  ADD CONSTRAINT supplier_offer_price_chk CHECK (price >= 0);
ALTER TABLE supplier_offer
  ADD CONSTRAINT supplier_offer_days_chk CHECK (delivery_days IS NULL OR delivery_days >= 0);

-- Поиск вариантов идёт по номенклатуре и поставщику вместе.
CREATE INDEX supplier_offer_pair_idx ON supplier_offer (nomenclature_id, supplier_id)
  WHERE deleted_at IS NULL;
