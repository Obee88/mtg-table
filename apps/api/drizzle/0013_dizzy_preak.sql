CREATE TABLE "token_uses" (
	"user_id" uuid NOT NULL,
	"deck_key" text DEFAULT '' NOT NULL,
	"token_key" text NOT NULL,
	"printing_id" uuid,
	"custom_name" text,
	"uses" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_uses_user_id_deck_key_token_key_pk" PRIMARY KEY("user_id","deck_key","token_key")
);
--> statement-breakpoint
ALTER TABLE "token_uses" ADD CONSTRAINT "token_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_uses" ADD CONSTRAINT "token_uses_printing_id_cards_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "token_uses_user_id_idx" ON "token_uses" USING btree ("user_id");