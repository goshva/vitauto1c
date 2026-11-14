ALTER TABLE "customer_order" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "refused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "refusal_reason" text;