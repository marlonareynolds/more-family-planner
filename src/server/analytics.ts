import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";

/**
 * Privacy-aware product events (spec 21.1). Each carries pseudonymous ids,
 * a type, the app version and at most a short reason code: never titles,
 * notes, places, children's names or diary contents. An adult who opts out
 * in Settings records nothing. Written in the command's own transaction, so
 * an event exists only for a change that committed.
 */
export const PRODUCT_EVENT_TYPES = [
  "household_created",
  "partner_joined",
  "first_plan_created",
  "moment_shared",
  "moment_agreed",
  "moment_completed",
  "care_gap_resolved",
  "save_conflict",
  "trial_response_saved",
  "calendar_connected",
  "active_day",
  "push_enabled",
  "week_planned",
  "ritual_started",
  "highlight_shared",
  "helper_asked",
  "setup_step",
] as const;
export type ProductEventType = (typeof PRODUCT_EVENT_TYPES)[number];

export function appVersion(): string {
  return (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);
}

export interface TrackInput {
  type: ProductEventType;
  accountId: string;
  householdId?: string | null;
  /** A code from a fixed vocabulary, never free text. */
  reason?: string | null;
  dedupeKey?: string | null;
}

export async function track(db: DbOrTx, e: TrackInput): Promise<void> {
  await db.execute(sql`
    insert into product_events (event_type, account_id, household_id, reason, app_version, dedupe_key)
    select ${e.type}, ${e.accountId}::uuid, ${e.householdId ?? null}::uuid, ${e.reason ?? null}, ${appVersion()}, ${e.dedupeKey ?? null}
    where not exists (select 1 from accounts where id = ${e.accountId}::uuid and analytics_opt_out)
    on conflict (dedupe_key) do nothing`);
}
