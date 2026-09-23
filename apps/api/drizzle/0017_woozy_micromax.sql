ALTER TABLE "cube_members" ADD COLUMN "status" text DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_config_members" ADD COLUMN "status" text DEFAULT 'accepted' NOT NULL;