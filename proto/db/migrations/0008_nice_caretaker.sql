ALTER TABLE "return_order" ADD COLUMN "kind" text;--> statement-breakpoint
CREATE INDEX "return_order_kind_idx" ON "return_order" USING btree ("kind");