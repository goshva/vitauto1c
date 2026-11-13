CREATE TABLE "stock_move" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nomenclature_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"cell_id" uuid,
	"batch_id" uuid,
	"line_id" uuid,
	"kind" text NOT NULL,
	"quantity" numeric(15, 3) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "stock_move_nomenclature_idx" ON "stock_move" USING btree ("nomenclature_id");--> statement-breakpoint
CREATE INDEX "stock_move_line_idx" ON "stock_move" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "stock_move_kind_idx" ON "stock_move" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "stock_move_place_idx" ON "stock_move" USING btree ("warehouse_id","cell_id","batch_id");