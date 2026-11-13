ALTER TABLE "supplier_order" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
CREATE INDEX "supplier_order_status_idx" ON "supplier_order" USING btree ("status");