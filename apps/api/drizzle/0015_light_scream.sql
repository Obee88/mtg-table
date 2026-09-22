CREATE TABLE "taplands" (
	"name" text PRIMARY KEY NOT NULL,
	"face" text NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "taplands" ADD CONSTRAINT "taplands_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;