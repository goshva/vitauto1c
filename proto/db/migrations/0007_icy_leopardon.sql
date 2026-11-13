CREATE TABLE "idempotency_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idempotency_key_uniq" ON "idempotency_key" USING btree ("key","method","path");--> statement-breakpoint
CREATE INDEX "idempotency_key_created_idx" ON "idempotency_key" USING btree ("created_at");