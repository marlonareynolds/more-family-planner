CREATE TABLE "kindness_marks" (
	"account_id" uuid NOT NULL,
	"week_key" date NOT NULL,
	"kindness_key" text NOT NULL,
	"mark" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kindness_marks_account_id_week_key_kindness_key_pk" PRIMARY KEY("account_id","week_key","kindness_key")
);
--> statement-breakpoint
CREATE TABLE "need_notes" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"sealed" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"about_id" uuid,
	"need" text NOT NULL,
	"shapes" boolean DEFAULT true NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "kindness_marks" ADD CONSTRAINT "kindness_marks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "need_notes" ADD CONSTRAINT "need_notes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_needs" ADD CONSTRAINT "partner_needs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_needs" ADD CONSTRAINT "partner_needs_about_id_accounts_id_fk" FOREIGN KEY ("about_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_needs_open" ON "partner_needs" USING btree ("account_id","need") WHERE "partner_needs"."until" is null;--> statement-breakpoint
CREATE INDEX "partner_needs_about" ON "partner_needs" USING btree ("about_id");--> statement-breakpoint
ALTER TABLE "partner_needs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "need_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kindness_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "partner_needs", "need_notes", "kindness_marks" FROM anon, authenticated;
  END IF;
END $$;
