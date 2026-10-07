CREATE TABLE "care_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"helper_id" uuid NOT NULL,
	"arrangement_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"response" text,
	"responded_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_asks_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "email_sends" (
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_sends_account_id_kind_period_key_pk" PRIMARY KEY("account_id","kind","period_key")
);
--> statement-breakpoint
CREATE TABLE "helpers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relation" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"moment_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "rituals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"organiser_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"activity_key" text,
	"participant_ids" uuid[] NOT NULL,
	"child_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"needs_care" boolean DEFAULT false NOT NULL,
	"budget_minor" bigint,
	"cadence" text NOT NULL,
	"starts_on" date NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"agreed_by" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_plans" (
	"household_id" uuid NOT NULL,
	"week_key" date NOT NULL,
	"account_id" uuid NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_plans_household_id_week_key_account_id_pk" PRIMARY KEY("household_id","week_key","account_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "push_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "weekly_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "quiet_start" text DEFAULT '21:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "quiet_end" text DEFAULT '07:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD COLUMN "helper_id" uuid;--> statement-breakpoint
ALTER TABLE "moments" ADD COLUMN "ritual_id" uuid;--> statement-breakpoint
ALTER TABLE "moments" ADD COLUMN "ritual_date" date;--> statement-breakpoint
ALTER TABLE "moments" ADD COLUMN "chosen_by_child_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "care_asks" ADD CONSTRAINT "care_asks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_asks" ADD CONSTRAINT "care_asks_helper_id_helpers_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."helpers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_asks" ADD CONSTRAINT "care_asks_arrangement_id_care_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."care_arrangements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_asks" ADD CONSTRAINT "care_asks_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpers" ADD CONSTRAINT "helpers_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_organiser_id_accounts_id_fk" FOREIGN KEY ("organiser_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_plans" ADD CONSTRAINT "week_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_plans" ADD CONSTRAINT "week_plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_asks_arrangement" ON "care_asks" USING btree ("arrangement_id");--> statement-breakpoint
CREATE INDEX "helpers_household" ON "helpers" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "highlights_moment_author" ON "highlights" USING btree ("moment_id","account_id");--> statement-breakpoint
CREATE INDEX "highlights_household_time" ON "highlights" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_owner" ON "push_subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "rituals_household" ON "rituals" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD CONSTRAINT "care_arrangements_helper_id_helpers_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."helpers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_ritual_id_rituals_id_fk" FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_chosen_by_child_id_children_id_fk" FOREIGN KEY ("chosen_by_child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moments_ritual_date" ON "moments" USING btree ("ritual_id","ritual_date") WHERE "moments"."ritual_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_unpushed" ON "notifications" USING btree ("created_at") WHERE "notifications"."pushed_at" is null;--> statement-breakpoint
-- Nothing already delivered in the app is pushed to a phone after the fact.
UPDATE "notifications" SET "pushed_at" = "created_at" WHERE "pushed_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlight_length" CHECK (char_length("text") BETWEEN 1 AND 280);
--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "ritual_duration" CHECK ("duration_minutes" BETWEEN 15 AND 1440);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "quiet_hours_format" CHECK ("quiet_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "quiet_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
--> statement-breakpoint
-- Same Data API lock as migration 0002 for every new table.
ALTER TABLE "care_asks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_sends" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "helpers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "highlights" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rituals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "week_plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "care_asks", "email_sends", "helpers", "highlights", "push_subscriptions", "rituals", "week_plans" FROM anon, authenticated;
  END IF;
END $$;
