CREATE TABLE "draft_picks" (
	"room_id" uuid NOT NULL,
	"overall_pick" integer NOT NULL,
	"player_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"phase" integer NOT NULL,
	"round" integer NOT NULL,
	"pack_id" text NOT NULL,
	"pick_in_pack" integer NOT NULL,
	"pack_contents" jsonb NOT NULL,
	"double_pick" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_picks_room_id_overall_pick_pk" PRIMARY KEY("room_id","overall_pick")
);
--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_picks_player_id_idx" ON "draft_picks" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "draft_picks_card_id_idx" ON "draft_picks" USING btree ("card_id");