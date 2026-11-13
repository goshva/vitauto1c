ALTER TABLE "shipment" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
CREATE INDEX "shipment_status_idx" ON "shipment" USING btree ("status");