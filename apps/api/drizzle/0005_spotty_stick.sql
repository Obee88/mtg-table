CREATE TABLE "cube_version_cards" (
	"version_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cube_version_cards_version_id_card_id_pk" PRIMARY KEY("version_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "cube_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cube_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cubes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cube_version_cards" ADD CONSTRAINT "cube_version_cards_version_id_cube_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."cube_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_version_cards" ADD CONSTRAINT "cube_version_cards_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_versions" ADD CONSTRAINT "cube_versions_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_versions" ADD CONSTRAINT "cube_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cubes" ADD CONSTRAINT "cubes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cube_versions_cube_id_idx" ON "cube_versions" USING btree ("cube_id");--> statement-breakpoint
CREATE INDEX "cubes_owner_id_idx" ON "cubes" USING btree ("owner_id");