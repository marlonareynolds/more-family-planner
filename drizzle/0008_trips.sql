CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"organiser_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"destination" text DEFAULT '' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"traveller_ids" uuid[] NOT NULL,
	"child_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_organiser_id_accounts_id_fk" FOREIGN KEY ("organiser_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trips_household_time" ON "trips" USING btree ("household_id","start_at");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trip_order" CHECK ("end_at" > "start_at");
--> statement-breakpoint
-- Same Data API lock as migration 0002 for every new table.
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "trips" FROM anon, authenticated;
  END IF;
END $$;
