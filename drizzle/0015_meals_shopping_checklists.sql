CREATE TABLE "dinners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"choice" text NOT NULL,
	"meal_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_step_done" (
	"step_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"household_id" uuid NOT NULL,
	"done_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_step_done_step_id_due_on_pk" PRIMARY KEY("step_id","due_on")
);
--> statement-breakpoint
CREATE TABLE "job_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quick" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"item_key" text NOT NULL,
	"dinner_id" uuid,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"got_at" timestamp with time zone,
	"got_by" uuid,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "dinners" ADD CONSTRAINT "dinners_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dinners" ADD CONSTRAINT "dinners_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dinners" ADD CONSTRAINT "dinners_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_step_done" ADD CONSTRAINT "job_step_done_step_id_job_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."job_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_step_done" ADD CONSTRAINT "job_step_done_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_step_done" ADD CONSTRAINT "job_step_done_done_by_accounts_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_dinner_id_dinners_id_fk" FOREIGN KEY ("dinner_id") REFERENCES "public"."dinners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_got_by_accounts_id_fk" FOREIGN KEY ("got_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dinners_household_date" ON "dinners" USING btree ("household_id","date");--> statement-breakpoint
CREATE INDEX "job_steps_job" ON "job_steps" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "meals_household" ON "meals" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "shopping_items_household" ON "shopping_items" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_items_dinner_key" ON "shopping_items" USING btree ("dinner_id","item_key");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_link_role" ON "jobs" USING btree ("for_id","role") WHERE "jobs"."role" is not null and "jobs"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "job_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_step_done" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dinners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shopping_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "job_steps", "job_step_done", "meals", "dinners", "shopping_items" FROM anon, authenticated;
  END IF;
END $$;
