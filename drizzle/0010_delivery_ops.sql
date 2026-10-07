CREATE TABLE "ops_runs" (
	"name" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"last_stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "support_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"contact" text DEFAULT '' NOT NULL,
	"topic" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "notifications_unpushed";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_error" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "relevance" jsonb;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_requests_open" ON "support_requests" USING btree ("created_at") WHERE "support_requests"."handled_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_push_due" ON "notifications" USING btree ("created_at") WHERE "notifications"."push_state" in ('pending', 'leased', 'retry');--> statement-breakpoint
-- Existing notifications: anything already pushed is "sent"; anything older
-- than the 16-hour push window is too late to send now.
UPDATE "notifications" SET "push_state" = 'sent' WHERE "pushed_at" IS NOT NULL;--> statement-breakpoint
UPDATE "notifications" SET "push_state" = 'expired' WHERE "pushed_at" IS NULL AND "created_at" < now() - interval '16 hours';--> statement-breakpoint
-- Same Data API lock as migration 0002 for every new table.
ALTER TABLE "ops_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "ops_runs", "support_requests" FROM anon, authenticated;
  END IF;
END $$;
