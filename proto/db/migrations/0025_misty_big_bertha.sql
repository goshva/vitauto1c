CREATE TABLE "supplier_offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nomenclature_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"price" numeric(15, 2) NOT NULL,
	"delivery_days" integer,
	"article" text,
	"comment" text,
	"actual_from" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "line" ADD COLUMN "supplier_offer_id" uuid;--> statement-breakpoint
CREATE INDEX "supplier_offer_nomenclature_idx" ON "supplier_offer" USING btree ("nomenclature_id");--> statement-breakpoint
CREATE INDEX "supplier_offer_supplier_idx" ON "supplier_offer" USING btree ("supplier_id");