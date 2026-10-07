CREATE TABLE "product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"account_id" uuid,
	"household_id" uuid,
	"reason" text,
	"app_version" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text,
	CONSTRAINT "product_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "trial_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"week_key" date NOT NULL,
	"baseline" boolean DEFAULT false NOT NULL,
	"me_moments" smallint,
	"us_moments" smallint,
	"family_moments" smallint,
	"minutes_in_app" smallint,
	"minutes_outside" smallint,
	"fairly_agreed" smallint,
	"continue_choice" text,
	"helped" text DEFAULT '' NOT NULL,
	"friction" text DEFAULT '' NOT NULL,
	"share_with_trial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "analytics_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_responses" ADD CONSTRAINT "trial_responses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_events_type_time" ON "product_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "product_events_household" ON "product_events" USING btree ("household_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_responses_owner_week" ON "trial_responses" USING btree ("account_id","week_key");--> statement-breakpoint
ALTER TABLE "trial_responses" ADD CONSTRAINT "trial_scale" CHECK ("fairly_agreed" IS NULL OR "fairly_agreed" BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE "trial_responses" ADD CONSTRAINT "trial_counts" CHECK (coalesce("me_moments", 0) BETWEEN 0 AND 50 AND coalesce("us_moments", 0) BETWEEN 0 AND 50 AND coalesce("family_moments", 0) BETWEEN 0 AND 50 AND coalesce("minutes_in_app", 0) BETWEEN 0 AND 6000 AND coalesce("minutes_outside", 0) BETWEEN 0 AND 6000);
--> statement-breakpoint
-- New tables get the same Data API lock as migration 0002.
ALTER TABLE "product_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trial_responses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "product_events", "trial_responses" FROM anon, authenticated;
  END IF;
END $$;
