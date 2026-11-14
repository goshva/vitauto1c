ALTER TABLE "nomenclature" ADD COLUMN "analog_id" uuid;
--> statement-breakpoint
-- Аналог — связанная номенклатура (ФТ v2 п. 16, блок «Аналоги»). В legacy это был
-- ref.nomenclature.analog_id («кросс-код», миграция 0013) — прямая связь без дерева.
ALTER TABLE "nomenclature"
  ADD CONSTRAINT "nomenclature_analog_fk"
  FOREIGN KEY ("analog_id") REFERENCES "nomenclature"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Позиция не может быть аналогом сама себе: подсказка «замените фильтр на фильтр»
-- бесполезна, а заметить такую связь глазами невозможно.
ALTER TABLE "nomenclature"
  ADD CONSTRAINT "nomenclature_analog_self_chk"
  CHECK ("analog_id" IS NULL OR "analog_id" <> "id");
--> statement-breakpoint
CREATE INDEX "nomenclature_analog_idx" ON "nomenclature" ("analog_id")
  WHERE "analog_id" IS NOT NULL;
