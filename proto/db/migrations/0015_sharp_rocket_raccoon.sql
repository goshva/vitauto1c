ALTER TABLE "stock_move" ADD COLUMN "work_order_id" uuid;--> statement-breakpoint
CREATE INDEX "stock_move_work_order_idx" ON "stock_move" USING btree ("work_order_id");--> statement-breakpoint
-- `write_off` (списание на ремонт, Q4) уменьшает остаток так же, как ручной `expense`.
-- Без этого правки движение создавалось бы, а остаток оставался прежним — ровно
-- тот дефект, из-за которого зона «Списание по ЗН» была ярлыком.
CREATE OR REPLACE VIEW stock_balance AS
SELECT
  sm.nomenclature_id                                        AS nomenclature_id,
  sm.warehouse_id                                           AS warehouse_id,
  sm.cell_id                                                AS cell_id,
  sm.batch_id                                               AS batch_id,
  coalesce(sum(CASE
    WHEN sm.kind IN ('receipt', 'return') THEN sm.quantity
    WHEN sm.kind IN ('expense', 'write_off') THEN -sm.quantity
    ELSE 0 END), 0)                                         AS on_hand,
  coalesce(sum(CASE
    WHEN sm.kind = 'reserve' THEN sm.quantity
    WHEN sm.kind = 'unreserve' THEN -sm.quantity
    ELSE 0 END), 0)                                         AS reserved
FROM stock_move sm
GROUP BY sm.nomenclature_id, sm.warehouse_id, sm.cell_id, sm.batch_id;