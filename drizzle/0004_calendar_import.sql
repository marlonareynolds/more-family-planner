CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"visibility" text DEFAULT 'busy_only' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"event_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "feed_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_feeds_owner" ON "calendar_feeds" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "calendar_feeds_household" ON "calendar_feeds" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_feed_id_calendar_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."calendar_feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_feed_external" ON "events" USING btree ("feed_id","external_id") WHERE "events"."feed_id" is not null;--> statement-breakpoint
-- Same Data API lock as migration 0002: the feed link is a secret.
ALTER TABLE "calendar_feeds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "calendar_feeds" FROM anon, authenticated;
  END IF;
END $$;
