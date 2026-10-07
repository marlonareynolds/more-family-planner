-- Overlapping reservations for one adult are impossible (INV-04, AT-08).
-- A generated range column keeps start/end and the constraint in step.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "during" tstzrange GENERATED ALWAYS AS (tstzrange("start_at", "end_at", '[)')) STORED;
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_no_overlap" EXCLUDE USING gist ("account_id" WITH =, "during" WITH &&);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_positive_duration" CHECK ("end_at" > "start_at" AND "duration_minutes" > 0);
--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_positive_duration" CHECK ("end_at" > "start_at");
--> statement-breakpoint
ALTER TABLE "care_requirements" ADD CONSTRAINT "care_req_positive_duration" CHECK ("end_at" > "start_at");
--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD CONSTRAINT "care_arr_positive_duration" CHECK ("end_at" > "start_at");
--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD CONSTRAINT "care_arr_parent_named" CHECK ("kind" <> 'parent' OR "responsible_account_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payments_positive" CHECK ("kind" = 'adjustment' OR "amount_minor" > 0);
--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_scale" CHECK (("energy" IS NULL OR "energy" BETWEEN 1 AND 5) AND ("pressure" IS NULL OR "pressure" BETWEEN 1 AND 5));
