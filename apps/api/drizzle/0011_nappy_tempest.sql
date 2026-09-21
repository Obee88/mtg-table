CREATE TABLE "draft_config_members" (
	"config_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_config_members_config_id_user_id_pk" PRIMARY KEY("config_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "draft_config_members" ADD CONSTRAINT "draft_config_members_config_id_draft_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."draft_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_config_members" ADD CONSTRAINT "draft_config_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_config_members_user_id_idx" ON "draft_config_members" USING btree ("user_id");