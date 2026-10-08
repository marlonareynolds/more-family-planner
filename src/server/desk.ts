import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db/client";
import { accounts, deskItems, events, holidayPeriods, jobs, trips } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { addDays } from "@/domain/time";
import { dayTitleKey } from "@/lib/desk-keys";
import type { Actor } from "./auth";
import { householdFor } from "./queries/week";

export { deskKeys } from "@/lib/desk-keys";

/**
 * The Household Desk's memory of what it has already put in the diary
 * (quality release, priority 4). The server, not the phone, decides whether
 * a notice is new, already added (by either adult), changed, or moved, so a
 * letter read twice, or by both parents, never doubles the diary. Matching is
 * by kind, title, children and date, never by a similar title alone: two
 * sessions, or two siblings' photographs, stay separate. The phone asks with
 * fingerprints only (lib/desk-keys), never the words of the letter.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const key = z.string().regex(/^[0-9a-f]{40}$/);

/** One card from the Desk, as the person left it after checking (sent only when adding). */
export const deskItemInput = z.object({
  /** The card's key on the phone, to match answers to cards. */
  ref: z.string().min(1).max(20),
  kind: z.enum(["event", "trip", "holiday", "job"]),
  title: z.string().trim().min(1).max(80),
  startDate: date,
  endDate: date,
  allDay: z.boolean().default(false),
  startTime: time.nullable().default(null),
  endTime: time.nullable().default(null),
  location: z.string().trim().max(200).default(""),
  details: z.string().trim().max(300).default(""),
  childIds: z.array(z.uuid()).max(8).default([]),
  /** "Keep this just for me": matched only against the same person's own items. */
  justMe: z.boolean().default(false),
});
export type DeskItemInput = z.infer<typeof deskItemInput>;

/** What the phone sends to check a card: fingerprints and a date, never words. */
export const deskCheckInput = z.object({
  ref: z.string().min(1).max(20),
  kind: z.enum(["event", "trip", "holiday", "job"]),
  startDate: date,
  seriesKey: key,
  identityKey: key,
  detailKey: key,
  dayTitleKey: key,
});
export type DeskCheckInput = z.infer<typeof deskCheckInput>;

export type DeskStatus =
  | { ref: string; status: "new" }
  /** The same thing is already in the diary, from an earlier read by either adult. */
  | { ref: string; status: "added"; by: string; on: string }
  /** The same thing, but the time, place or details changed since it was added. */
  | { ref: string; status: "changed"; by: string; on: string; targetType: string; targetId: string }
  /** The same thing on another date: perhaps it moved. */
  | { ref: string; status: "moved"; was: string; targetType: string; targetId: string }
  /** Something with this name is already in the diary that day, added by hand. */
  | { ref: string; status: "similar"; title: string };

/** Is the diary item a desk row points at still there? */
export async function deskTargetAlive(db: DbOrTx, type: string, id: string): Promise<boolean> {
  if (type === "event") return !!(await db.select({ id: events.id }).from(events).where(and(eq(events.id, id), isNull(events.cancelledAt)))).length;
  if (type === "trip") return !!(await db.select({ id: trips.id }).from(trips).where(and(eq(trips.id, id), isNull(trips.cancelledAt)))).length;
  if (type === "holiday") return !!(await db.select({ id: holidayPeriods.id }).from(holidayPeriods).where(and(eq(holidayPeriods.id, id), isNull(holidayPeriods.archivedAt)))).length;
  return !!(await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, id), isNull(jobs.archivedAt)))).length;
}

/** The desk rows this person may know about: shared ones and their own "just for me" ones. */
async function visibleRows(db: DbOrTx, householdId: string, viewerId: string, keys: { identity: string[]; series: string[] }) {
  if (!keys.identity.length) return [];
  return db
    .select({ row: deskItems, by: accounts.displayName })
    .from(deskItems)
    .innerJoin(accounts, eq(accounts.id, deskItems.createdBy))
    .where(
      and(
        eq(deskItems.householdId, householdId),
        or(inArray(deskItems.identityKey, keys.identity), inArray(deskItems.seriesKey, keys.series)),
        or(isNull(deskItems.privateTo), eq(deskItems.privateTo, viewerId)),
      ),
    );
}

export async function deskStatuses(db: DbOrTx, householdId: string, viewer: Actor, items: DeskCheckInput[]): Promise<DeskStatus[]> {
  const rows = await visibleRows(db, householdId, viewer.accountId, { identity: items.map((x) => x.identityKey), series: items.map((x) => x.seriesKey) });
  const live = new Map<string, boolean>();
  for (const { row } of rows) live.set(row.id, await deskTargetAlive(db, row.targetType, row.targetId));
  const isLive = (r: (typeof rows)[number]) => live.get(r.row.id) === true;
  const on = (r: (typeof rows)[number]) => r.row.createdAt.toISOString().slice(0, 10);
  const by = (r: (typeof rows)[number]) => (r.row.createdBy === viewer.accountId ? "you" : r.by);

  // Hand-made diary entries on the same days, fingerprinted the same way, for "looks like it's already there".
  const days = [...new Set(items.filter((x) => x.kind === "event").map((x) => x.startDate))];
  const handMade = new Map<string, string>();
  if (days.length) {
    const rowsOnDays = await db
      .select({ id: events.id, title: events.title, localStart: events.localStart, visibility: events.visibility, ownerId: events.ownerId })
      .from(events)
      .where(
        and(
          eq(events.householdId, householdId),
          isNull(events.cancelledAt),
          isNull(events.rule),
          gte(events.localStart, `${days.reduce((a, b) => (a < b ? a : b))}T00:00`),
          lte(events.localStart, `${days.reduce((a, b) => (a > b ? a : b))}T23:59`),
        ),
      );
    // Entries the Desk itself added are matched by fingerprint above, not here: a sibling's copy isn't "similar".
    const fromDesk = rowsOnDays.length
      ? new Set((await db.select({ id: deskItems.targetId }).from(deskItems).where(and(eq(deskItems.householdId, householdId), inArray(deskItems.targetId, rowsOnDays.map((e) => e.id))))).map((r) => r.id))
      : new Set<string>();
    for (const e of rowsOnDays) {
      if (fromDesk.has(e.id)) continue;
      if (e.visibility !== "shared" && e.ownerId !== viewer.accountId) continue;
      handMade.set(await dayTitleKey(householdId, e.localStart.slice(0, 10), e.title), e.title);
    }
  }
  const listed = new Set(items.map((x) => x.identityKey));

  return items.map((i): DeskStatus => {
    const exact = rows.find((r) => r.row.identityKey === i.identityKey && isLive(r));
    if (exact) {
      return exact.row.detailKey === i.detailKey
        ? { ref: i.ref, status: "added", by: by(exact), on: on(exact) }
        : { ref: i.ref, status: "changed", by: by(exact), on: on(exact), targetType: exact.row.targetType, targetId: exact.row.targetId };
    }
    // The same thing at another time or nearby date that this letter doesn't also list: it changed or moved.
    const near = rows.filter(
      (r) => r.row.seriesKey === i.seriesKey && isLive(r) && !listed.has(r.row.identityKey) && r.row.startDate >= addDays(i.startDate, -60) && r.row.startDate <= addDays(i.startDate, 60),
    );
    const sameDay = near.find((r) => r.row.startDate === i.startDate);
    if (sameDay) return { ref: i.ref, status: "changed", by: by(sameDay), on: on(sameDay), targetType: sameDay.row.targetType, targetId: sameDay.row.targetId };
    const moved = near[0];
    if (moved) return { ref: i.ref, status: "moved", was: moved.row.startDate, targetType: moved.row.targetType, targetId: moved.row.targetId };
    const twin = i.kind === "event" ? handMade.get(i.dayTitleKey) : undefined;
    if (twin) return { ref: i.ref, status: "similar", title: twin };
    return { ref: i.ref, status: "new" };
  });
}

export async function checkDesk(db: Db, actor: Actor, householdId: string, items: DeskCheckInput[]): Promise<DeskStatus[]> {
  const household = await householdFor(db, actor);
  if (!household || household.id !== householdId) throw new DomainError("NOT_FOUND", "You are not in this household.");
  return deskStatuses(db, householdId, actor, items);
}
