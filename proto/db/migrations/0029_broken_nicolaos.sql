CREATE TABLE "scheduled_job" (
	"name" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"schedule" text NOT NULL,
	"every_hours" integer NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"failed_streak" integer DEFAULT 0 NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_job_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"message" text,
	"started_by" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX "scheduled_job_run_name_idx" ON "scheduled_job_run" USING btree ("name","started_at");--> statement-breakpoint
CREATE INDEX "scheduled_job_run_started_idx" ON "scheduled_job_run" USING btree ("started_at");