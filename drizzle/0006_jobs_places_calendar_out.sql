CREATE TABLE "calendar_exports" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp with time zone,
	CONSTRAINT "calendar_exports_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "job_done" (
	"job_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"household_id" uuid NOT NULL,
	"done_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_done_job_id_due_on_pk" PRIMARY KEY("job_id","due_on")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"cadence" text NOT NULL,
	"starts_on" date NOT NULL,
	"remind_day_before" boolean DEFAULT false NOT NULL,
	"minutes" smallint DEFAULT 15 NOT NULL,
	"owner_id" uuid,
	"proposed_owner_id" uuid,
	"proposed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"kinds" text[] NOT NULL,
	"category" text NOT NULL,
	"setting" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"typical_cost_minor" bigint DEFAULT 0 NOT NULL,
	"duration_minutes" integer DEFAULT 120 NOT NULL,
	"step_free" boolean DEFAULT false NOT NULL,
	"calm" boolean DEFAULT false NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_exports" ADD CONSTRAINT "calendar_exports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_done" ADD CONSTRAINT "job_done_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_done" ADD CONSTRAINT "job_done_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_done" ADD CONSTRAINT "job_done_done_by_accounts_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_proposed_owner_id_accounts_id_fk" FOREIGN KEY ("proposed_owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_proposed_by_accounts_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_household" ON "jobs" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "places_household" ON "places" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "job_minutes" CHECK ("minutes" BETWEEN 1 AND 600);
--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "place_duration" CHECK ("duration_minutes" BETWEEN 15 AND 1440);
--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "place_cost" CHECK ("typical_cost_minor" >= 0);
--> statement-breakpoint
-- Same Data API lock as migration 0002 for every new table.
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_done" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "places" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calendar_exports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "jobs", "job_done", "places", "calendar_exports" FROM anon, authenticated;
  END IF;
END $$;
