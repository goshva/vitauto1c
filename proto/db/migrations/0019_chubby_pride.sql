CREATE TABLE "brand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"country" text,
	"comment" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "nomenclature" ADD COLUMN "ext_code" text;--> statement-breakpoint
CREATE INDEX "brand_name_idx" ON "brand" USING btree ("name");--> statement-breakpoint
ALTER TABLE "nomenclature" ADD CONSTRAINT "nomenclature_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomenclature" ADD CONSTRAINT "nomenclature_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nomenclature_ext_code_idx" ON "nomenclature" USING btree ("ext_code");