CREATE TABLE "customer_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"date" timestamp DEFAULT now() NOT NULL,
	"operation" text,
	"client_order_number" text,
	"counterparty_id" uuid,
	"contract_id" uuid,
	"organization_id" uuid,
	"ship_date" timestamp,
	"total" numeric(15, 2),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"message" text,
	"processed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node" text NOT NULL,
	"kind" text NOT NULL,
	"recipient_role" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"customer_order_id" uuid
);
--> statement-breakpoint
CREATE TABLE "receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"date" timestamp DEFAULT now() NOT NULL,
	"operation" text,
	"counterparty_id" uuid,
	"contract_id" uuid,
	"organization_id" uuid,
	"warehouse_id" uuid,
	"total" numeric(15, 2),
	"posted" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "return_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"date" timestamp DEFAULT now() NOT NULL,
	"operation" text,
	"counterparty_id" uuid,
	"contract_id" uuid,
	"organization_id" uuid,
	"warehouse_id" uuid,
	"total" numeric(15, 2),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"date" timestamp DEFAULT now() NOT NULL,
	"operation" text,
	"counterparty_id" uuid,
	"contract_id" uuid,
	"organization_id" uuid,
	"customer_order_id" uuid,
	"warehouse_id" uuid,
	"zone_id" uuid,
	"total" numeric(15, 2),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "supplier_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"date" timestamp DEFAULT now() NOT NULL,
	"operation" text,
	"counterparty_id" uuid,
	"contract_id" uuid,
	"organization_id" uuid,
	"customer_order_id" uuid,
	"receipt_date" timestamp,
	"total" numeric(15, 2),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"date" timestamp DEFAULT now() NOT NULL,
	"car_id" uuid,
	"counterparty_id" uuid,
	"organization_id" uuid,
	"service_type_id" uuid,
	"total" numeric(15, 2),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"batch_no" text,
	"supplier_id" uuid,
	"status" text,
	"expires_at" timestamp,
	"inactive" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "car" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"vin" text,
	"year" integer,
	"model_id" uuid,
	"engine_no" text,
	"body_no" text,
	"chassis_no" text,
	"color" text,
	"comment" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "car_attribute" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"car_id" uuid,
	"attr_kind" text NOT NULL,
	"value_type" text,
	"value_value" text,
	"period" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text,
	"contract_no" text,
	"contract_date" timestamp,
	"counterparty_id" uuid,
	"organization_id" uuid,
	"price_type_id" uuid,
	"kind" text,
	"inactive" boolean DEFAULT false NOT NULL,
	"comment" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "counterparty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"full_name" text,
	"legal_form" text,
	"inn" text,
	"kpp" text,
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"inactive" boolean DEFAULT false NOT NULL,
	"comment" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nomenclature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"article" text,
	"full_name" text,
	"unit_id" uuid,
	"kind" text,
	"brand_id" uuid,
	"price" numeric(15, 2),
	"price_type_id" uuid,
	"comment" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"full_name" text,
	"short_name" text,
	"inn" text,
	"kpp" text,
	"ogrn" text,
	"prefix" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_form" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_kind" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "storage_cell" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid,
	"zone_id" uuid,
	"code" text,
	"capacity" numeric(15, 2),
	"blocked" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"full_name" text,
	"intl_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "warehouse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"organization_id" uuid,
	"is_warehouse" boolean DEFAULT true NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "warehouse_zone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"purpose" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "customer_order_number_idx" ON "customer_order" USING btree ("number");--> statement-breakpoint
CREATE INDEX "job_state_idx" ON "job" USING btree ("state");--> statement-breakpoint
CREATE INDEX "notice_node_idx" ON "notice" USING btree ("node");--> statement-breakpoint
CREATE INDEX "notice_unread_idx" ON "notice" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "receipt_number_idx" ON "receipt" USING btree ("number");--> statement-breakpoint
CREATE INDEX "return_order_number_idx" ON "return_order" USING btree ("number");--> statement-breakpoint
CREATE INDEX "shipment_number_idx" ON "shipment" USING btree ("number");--> statement-breakpoint
CREATE INDEX "supplier_order_number_idx" ON "supplier_order" USING btree ("number");--> statement-breakpoint
CREATE INDEX "work_order_number_idx" ON "work_order" USING btree ("number");--> statement-breakpoint
CREATE INDEX "batch_supplier_idx" ON "batch" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "car_vin_idx" ON "car" USING btree ("vin");--> statement-breakpoint
CREATE INDEX "car_attribute_car_idx" ON "car_attribute" USING btree ("car_id");--> statement-breakpoint
CREATE INDEX "car_attribute_kind_idx" ON "car_attribute" USING btree ("attr_kind");--> statement-breakpoint
CREATE INDEX "contract_counterparty_idx" ON "contract" USING btree ("counterparty_id");--> statement-breakpoint
CREATE INDEX "counterparty_name_idx" ON "counterparty" USING btree ("name");--> statement-breakpoint
CREATE INDEX "counterparty_inn_idx" ON "counterparty" USING btree ("inn");--> statement-breakpoint
CREATE INDEX "nomenclature_code_idx" ON "nomenclature" USING btree ("code");--> statement-breakpoint
CREATE INDEX "nomenclature_article_idx" ON "nomenclature" USING btree ("article");--> statement-breakpoint
CREATE INDEX "nomenclature_name_idx" ON "nomenclature" USING btree ("name");--> statement-breakpoint
CREATE INDEX "storage_cell_zone_idx" ON "storage_cell" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "warehouse_zone_code_idx" ON "warehouse_zone" USING btree ("code");