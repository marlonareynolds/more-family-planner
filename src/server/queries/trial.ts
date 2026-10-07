import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, memberships, productEvents, trialResponses } from "@/db/schema";
import type { Actor } from "../auth";

export type TrialResponse = typeof trialResponses.$inferSelect;

export interface TrialView {
  /** Your own answers, newest week first. */
  mine: TrialResponse[];
  /** Your partner's answers that they chose to share with the trial. */
  shared: (TrialResponse & { authorName: string })[];
  /** Weeks in which each current adult answered at all; content stays private. */
  coverage: { accountId: string; displayName: string; weeks: string[] }[];
  /** Household product events over the trial window, by type. */
  events: { type: string; count: number }[];
  /** Days with at least one adult active, and days with both. */
  activeDays: { any: number; both: number };
  optedOut: boolean;
  since: string;
}

/**
 * What the household trial can show an adult (spec 21.2): their own
 * answers, a partner's only where shared, and counts that reveal no content.
 */
export async function trialFor(db: Db, actor: Actor, householdId: string, now = new Date(), days = 42): Promise<TrialView> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const adults = await db
    .select({ id: accounts.id, displayName: accounts.displayName, optOut: accounts.analyticsOptOut })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(eq(memberships.householdId, householdId), isNull(memberships.endsAt)));
  const ids = adults.map((a) => a.id);
  const responses = ids.length
    ? await db.select().from(trialResponses).where(inArray(trialResponses.accountId, ids)).orderBy(desc(trialResponses.weekKey))
    : [];
  const name = (id: string) => adults.find((a) => a.id === id)?.displayName ?? "Partner";
  const events = await db
    .select({ type: productEvents.eventType, count: sql<number>`count(*)::int` })
    .from(productEvents)
    .where(and(eq(productEvents.householdId, householdId), gte(productEvents.occurredAt, since), sql`${productEvents.eventType} <> 'active_day'`))
    .groupBy(productEvents.eventType);
  const activeRows = await db
    .select({ day: sql<string>`substr(${productEvents.dedupeKey}, length(${productEvents.dedupeKey}) - 9)`, n: sql<number>`count(distinct ${productEvents.accountId})::int` })
    .from(productEvents)
    .where(and(eq(productEvents.householdId, householdId), eq(productEvents.eventType, "active_day"), gte(productEvents.occurredAt, since)))
    .groupBy(sql`1`);
  return {
    mine: responses.filter((r) => r.accountId === actor.accountId),
    shared: responses.filter((r) => r.accountId !== actor.accountId && r.shareWithTrial).map((r) => ({ ...r, authorName: name(r.accountId) })),
    coverage: adults.map((a) => ({ accountId: a.id, displayName: a.displayName, weeks: responses.filter((r) => r.accountId === a.id).map((r) => r.weekKey) })),
    events: events.sort((a, b) => a.type.localeCompare(b.type)),
    activeDays: { any: activeRows.length, both: activeRows.filter((d) => d.n >= 2).length },
    optedOut: adults.find((a) => a.id === actor.accountId)?.optOut ?? false,
    since: since.toISOString().slice(0, 10),
  };
}
