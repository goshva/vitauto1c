ALTER TABLE "line" ADD COLUMN "work_order_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
CREATE INDEX "work_order_status_idx" ON "work_order" USING btree ("status");