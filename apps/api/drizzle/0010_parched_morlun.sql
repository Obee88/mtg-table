CREATE TABLE "cube_members" (
	"cube_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cube_members_cube_id_user_id_pk" PRIMARY KEY("cube_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cube_members" ADD CONSTRAINT "cube_members_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_members" ADD CONSTRAINT "cube_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cube_members_user_id_idx" ON "cube_members" USING btree ("user_id");