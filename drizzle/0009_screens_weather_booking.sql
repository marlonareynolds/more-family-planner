CREATE TABLE "child_wishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"activity_key" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "display_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "display_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "weather_forecasts" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"hours" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "place_name" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "booking_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "child_wishes" ADD CONSTRAINT "child_wishes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_wishes" ADD CONSTRAINT "child_wishes_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_links" ADD CONSTRAINT "display_links_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_links" ADD CONSTRAINT "display_links_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_links" ADD CONSTRAINT "display_links_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_forecasts" ADD CONSTRAINT "weather_forecasts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "child_wishes_open" ON "child_wishes" USING btree ("child_id") WHERE "child_wishes"."handled_at" is null;--> statement-breakpoint
CREATE INDEX "display_links_household" ON "display_links" USING btree ("household_id");--> statement-breakpoint
-- Same Data API lock as migration 0002 for every new table.
ALTER TABLE "display_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "child_wishes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "weather_forecasts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "display_links", "child_wishes", "weather_forecasts" FROM anon, authenticated;
  END IF;
END $$;
