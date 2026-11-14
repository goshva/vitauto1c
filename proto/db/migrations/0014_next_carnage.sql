CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"date" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"kind" text DEFAULT 'outgoing' NOT NULL,
	"counterparty_id" uuid,
	"organization_id" uuid,
	"customer_order_id" uuid,
	"supplier_order_id" uuid,
	"amount" numeric(15, 2),
	"paid_at" timestamp with time zone,
	"comment" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"head_employee_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"department_id" uuid,
	"position" text,
	"phone" text,
	"email" text,
	"can_sign" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "maintenance_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"car_model_id" uuid,
	"mileage_interval" integer,
	"day_interval" integer,
	"norm_hours" numeric(10, 2),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "line" ADD COLUMN "executor_id" uuid;--> statement-breakpoint
ALTER TABLE "line" ADD COLUMN "issued_by_id" uuid;--> statement-breakpoint
ALTER TABLE "car" ADD COLUMN "mileage" integer;--> statement-breakpoint
ALTER TABLE "car" ADD COLUMN "mileage_at_service" integer;--> statement-breakpoint
ALTER TABLE "car" ADD COLUMN "last_service_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "car" ADD COLUMN "status" text DEFAULT 'on_line' NOT NULL;--> statement-breakpoint
ALTER TABLE "car" ADD COLUMN "department_id" uuid;--> statement-breakpoint
CREATE INDEX "invoice_status_idx" ON "invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_order_idx" ON "invoice" USING btree ("customer_order_id");--> statement-breakpoint
CREATE INDEX "invoice_supplier_order_idx" ON "invoice" USING btree ("supplier_order_id");--> statement-breakpoint
CREATE INDEX "department_code_idx" ON "department" USING btree ("code");--> statement-breakpoint
CREATE INDEX "employee_role_idx" ON "employee" USING btree ("role");--> statement-breakpoint
CREATE INDEX "employee_department_idx" ON "employee" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "maintenance_rule_model_idx" ON "maintenance_rule" USING btree ("car_model_id");--> statement-breakpoint
CREATE INDEX "car_status_idx" ON "car" USING btree ("status");