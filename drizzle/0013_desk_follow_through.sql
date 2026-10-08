CREATE TABLE "desk_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"identity_key" text NOT NULL,
	"series_key" text NOT NULL,
	"detail_key" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"private_to" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "due_time" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "for_type" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "for_id" uuid;--> statement-breakpoint
ALTER TABLE "desk_items" ADD CONSTRAINT "desk_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_items" ADD CONSTRAINT "desk_items_private_to_accounts_id_fk" FOREIGN KEY ("private_to") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_items" ADD CONSTRAINT "desk_items_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "desk_items_identity" ON "desk_items" USING btree ("household_id","identity_key");--> statement-breakpoint
CREATE INDEX "desk_items_series" ON "desk_items" USING btree ("household_id","series_key");--> statement-breakpoint
ALTER TABLE "desk_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "desk_items" FROM anon, authenticated;
  END IF;
END $$;
