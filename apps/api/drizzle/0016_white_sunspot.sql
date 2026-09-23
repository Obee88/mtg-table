ALTER TABLE "cubes" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "draft_configs" ADD COLUMN "deleted_at" timestamp with time zone;