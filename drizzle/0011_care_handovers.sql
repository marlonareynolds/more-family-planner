ALTER TABLE "care_arrangements" ADD COLUMN "replaces_id" uuid;--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD COLUMN "drop_off_by" uuid;--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD COLUMN "drop_off_agreed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD COLUMN "collect_by" uuid;--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD COLUMN "collect_agreed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD COLUMN "handover_minutes" smallint DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD CONSTRAINT "care_arrangements_replaces_id_care_arrangements_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."care_arrangements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD CONSTRAINT "care_arrangements_drop_off_by_accounts_id_fk" FOREIGN KEY ("drop_off_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_arrangements" ADD CONSTRAINT "care_arrangements_collect_by_accounts_id_fk" FOREIGN KEY ("collect_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;