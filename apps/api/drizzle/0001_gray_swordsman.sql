CREATE TABLE "card_ingests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"bulk_updated_at" text,
	"processed" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"oracle_id" uuid,
	"name" text NOT NULL,
	"lang" text NOT NULL,
	"layout" text NOT NULL,
	"set_code" text NOT NULL,
	"set_name" text NOT NULL,
	"set_type" text NOT NULL,
	"collector_number" text NOT NULL,
	"released_at" date NOT NULL,
	"rarity" text NOT NULL,
	"type_line" text,
	"mana_cost" text,
	"cmc" real,
	"colors" text[],
	"color_identity" text[] NOT NULL,
	"oracle_text" text,
	"image_uris" jsonb,
	"faces" jsonb NOT NULL,
	"is_token" boolean DEFAULT false NOT NULL,
	"is_digital" boolean DEFAULT false NOT NULL,
	"is_promo" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cards_name_lower_idx" ON "cards" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "cards_oracle_id_idx" ON "cards" USING btree ("oracle_id");--> statement-breakpoint
CREATE INDEX "cards_set_code_idx" ON "cards" USING btree ("set_code");