CREATE TABLE "line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_order_id" uuid,
	"supplier_order_id" uuid,
	"receipt_id" uuid,
	"operation" text,
	"nomenclature_id" uuid,
	"quantity" numeric(10, 2),
	"supplier_id" uuid,
	"batch_id" uuid,
	"status" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"sale_price" numeric(15, 2),
	"contract_id" uuid,
	"customer_id" uuid,
	"comment" text,
	"order_date" timestamp,
	"internal_order_number" text,
	"service_type_id" uuid,
	"urgency" text,
	"territory" text,
	"cost_price" numeric(15, 2),
	"signed_original" boolean,
	"norm_hours" numeric(15, 2),
	"rrc" numeric(15, 2),
	"comment2" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"warehouse_id" uuid,
	"cell_id" uuid,
	"self_pickup" boolean DEFAULT false NOT NULL,
	"zone_id" uuid,
	"deleted_by_id" uuid,
	"deleted_at" timestamp with time zone,
	"extra_flag" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_fact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_order_number" text,
	"fact_name" text,
	"fact_qty" text,
	"vehicle_plate" text,
	"fact_article" text,
	"fact_unit" text
);
--> statement-breakpoint
CREATE TABLE "line_mark" (
	"id" uuid PRIMARY KEY NOT NULL,
	"marked" boolean DEFAULT false NOT NULL,
	"marked_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "line_fact" ADD CONSTRAINT "line_fact_id_line_id_fk" FOREIGN KEY ("id") REFERENCES "public"."line"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_mark" ADD CONSTRAINT "line_mark_id_line_id_fk" FOREIGN KEY ("id") REFERENCES "public"."line"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_status_idx" ON "line" USING btree ("status");--> statement-breakpoint
CREATE INDEX "line_customer_order_idx" ON "line" USING btree ("customer_order_id");--> statement-breakpoint
CREATE INDEX "line_supplier_order_idx" ON "line" USING btree ("supplier_order_id");--> statement-breakpoint
CREATE INDEX "line_nomenclature_idx" ON "line" USING btree ("nomenclature_id");--> statement-breakpoint
CREATE INDEX "line_id_version_idx" ON "line" USING btree ("id","version");