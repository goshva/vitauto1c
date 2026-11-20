ALTER TABLE "work_order" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "work_order_closed_idx" ON "work_order" USING btree ("closed_at");--> statement-breakpoint
UPDATE "work_order" SET "closed_at" = "updated_at" WHERE "status" = 'closed' AND "closed_at" IS NULL;
