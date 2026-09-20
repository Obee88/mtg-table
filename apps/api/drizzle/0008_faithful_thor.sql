CREATE TABLE "game_results" (
	"room_id" uuid NOT NULL,
	"game_number" integer NOT NULL,
	"reported_by" uuid NOT NULL,
	"winners" jsonb NOT NULL,
	"mode" text NOT NULL,
	"player_count" integer NOT NULL,
	"commander" boolean NOT NULL,
	"draft_name" text,
	"players" jsonb NOT NULL,
	"note" text,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_results_room_id_game_number_pk" PRIMARY KEY("room_id","game_number")
);
--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_results_reported_at_idx" ON "game_results" USING btree ("reported_at");