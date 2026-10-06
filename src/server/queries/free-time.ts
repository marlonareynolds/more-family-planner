import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, calendarFeeds, checkins, children, memberships } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { suggestTimes, type MomentKind, type SuggestedTime } from "@/domain/free-time";
import { currentWeekKey } from "@/domain/time";
import type { Actor } from "../auth";
import { STALE_AFTER_MS } from "../calendar-sync";
import { loadBusy, loadEventOccurrences } from "./busy";
import { householdFor } from "./week";

export interface FreeTimes {
  slots: SuggestedTime[];
  /** People whose connected calendar isn't current, so their free time is uncertain. */
  uncertainFor: string[];
  /** The viewer's own check-in says this week is heavy: shorter options are offered first. */
  lighterWeek: boolean;
}

export async function freeTimesFor(db: Db, actor: Actor, kind: MomentKind, minutes: number, now = new Date(), days = 14): Promise<FreeTimes> {
  const household = await householdFor(db, actor);
  if (!household) throw new DomainError("NOT_FOUND", "You are not in a household.");
  const adults = await db
    .select({ id: accounts.id, displayName: accounts.displayName })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(eq(memberships.householdId, household.id), isNull(memberships.endsAt)));
  const kids = await db.select({ id: children.id }).from(children).where(and(eq(children.householdId, household.id), isNull(children.archivedAt)));
  const horizon = { start: now.getTime(), end: now.getTime() + (days + 1) * 86_400_000 };
  const busy = await loadBusy(db, household.id, horizon);
  const childBusy =
    kind === "family"
      ? (await loadEventOccurrences(db, household.id, horizon)).filter((o) => o.row.childIds.length > 0).map((o) => ({ start: o.start, end: o.end }))
      : [];
  const participants = kind === "me" ? [actor.accountId] : adults.map((a) => a.id);
  const slots = suggestTimes({
    kind,
    now: now.getTime(),
    timeZone: household.timeZone,
    days,
    durationMinutes: minutes,
    participantIds: participants,
    carerIds: adults.map((a) => a.id).filter((id) => !participants.includes(id)),
    hasChildren: kids.length > 0,
    busy,
    childBusy,
  });

  const feeds = await db.select().from(calendarFeeds).where(eq(calendarFeeds.householdId, household.id));
  const uncertainFor = [
    ...new Set(
      feeds
        .filter((f) => participants.includes(f.accountId) && (!f.lastSuccessAt || now.getTime() - f.lastSuccessAt.getTime() > STALE_AFTER_MS))
        .map((f) => (f.accountId === actor.accountId ? "You" : (adults.find((a) => a.id === f.accountId)?.displayName ?? "Partner"))),
    ),
  ];
  return { slots, uncertainFor, lighterWeek: await heavyWeek(db, actor, household.timeZone, now) };
}

/**
 * Whether the viewer's own check-in this week says low energy or high
 * pressure (spec 8.3). Only ever used to shape the viewer's own suggestions;
 * missing answers mean unknown, not plenty of capacity, so they change nothing.
 */
export async function heavyWeek(db: Db, actor: Actor, timeZone: string, now = new Date()): Promise<boolean> {
  const [mine] = await db
    .select({ energy: checkins.energy, pressure: checkins.pressure })
    .from(checkins)
    .where(and(eq(checkins.accountId, actor.accountId), eq(checkins.weekKey, currentWeekKey(timeZone, now.getTime()))));
  return !!mine && ((mine.energy !== null && mine.energy <= 2) || (mine.pressure !== null && mine.pressure >= 4));
}
