ALTER TABLE "households" ADD COLUMN "evening_ends" text DEFAULT '19:30' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "bedtime" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "weekly_guide_minor" bigint;