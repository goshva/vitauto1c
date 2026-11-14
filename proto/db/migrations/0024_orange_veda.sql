ALTER TABLE "customer_order" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "receipt" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "return_order" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_order" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_move" ADD COLUMN "author_id" uuid;