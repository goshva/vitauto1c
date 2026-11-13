ALTER TABLE "return_order" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
CREATE INDEX "return_order_status_idx" ON "return_order" USING btree ("status");