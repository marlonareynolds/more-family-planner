import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db/client";
import type { Temporal } from "@js-temporal/polyfill";
import { accounts, deskItems, events, holidayPeriods, households, jobs, trips } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { addDays, instantToLocal } from "@/domain/time";
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

/** What the phone sends to check a card: fingerprints, dates and times, never words. */
export const deskCheckInput = z.object({
  ref: z.string().min(1).max(20),
  kind: z.enum(["event", "trip", "holiday", "job"]),
  startDate: date,
  /** As the diary would hold them (lib/desk-keys diaryTimes), to compare with what's there now. */
  startTime: time.nullable().default(null),
  endDate: date.optional(),
  endTime: time.nullable().default(null),
  seriesKey: key,
  identityKey: key,
  detailKey: key,
  dayTitleKey: key,
});
export type DeskCheckInput = z.infer<typeof deskCheckInput>;

/** A diary item as it stands now, for the person to compare with the letter. */
export interface DeskTarget {
  targetType: "event" | "trip" | "holiday" | "job";
  targetId: string;
  version: number;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
  /** A repeating entry is changed in the diary, never replaced from a letter. */
  recurring: boolean;
}

export type DeskStatus =
  | { ref: string; status: "new" }
  /** The same thing is already in the diary as the letter has it, from an earlier read by either adult. */
  | { ref: string; status: "added"; by: string; on: string }
  /** The same thing, but the letter and the diary now differ (the notice changed, or someone edited the entry). */
  | { ref: string; status: "changed"; by: string; on: string; current: DeskTarget }
  /**
   * Something with this name for the same children is in the diary at another
   * time that day, or on a nearby date. It may be another session, or it may
   * have moved: the person decides, so nothing here says which.
   */
  | { ref: string; status: "possible"; sameDay: boolean; candidates: DeskTarget[] }
  /** Something with this name is already in the diary that day, added by hand. */
  | { ref: string; status: "similar"; title: string };

const clock = (d: Temporal.PlainDateTime) => d.toPlainTime().toString().slice(0, 5);

/**
 * The diary item a desk row points at, as this viewer may see it now. Gone,
 * cancelled, or no longer visible to them (made private by the other adult)
 * reads as nothing: an old shared desk row never discloses it.
 */
export async function deskTarget(db: DbOrTx, householdId: string, viewerId: string, timeZone: string, type: string, id: string): Promise<DeskTarget | null> {
  if (type === "event") {
    const [e] = await db.select().from(events).where(and(eq(events.id, id), eq(events.householdId, householdId), isNull(events.cancelledAt)));
    if (!e || (e.visibility !== "shared" && e.ownerId !== viewerId)) return null;
    const end = instantToLocal(e.endAt.getTime() - (e.allDay ? 1 : 0), timeZone);
    return {
      targetType: "event",
      targetId: e.id,
      version: e.version,
      startDate: e.localStart.slice(0, 10),
      startTime: e.allDay ? null : e.localStart.slice(11, 16),
      endDate: end.toPlainDate().toString(),
      endTime: e.allDay ? null : clock(end),
      recurring: e.rule !== null,
    };
  }
  if (type === "trip") {
    const [t] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.householdId, householdId), isNull(trips.cancelledAt)));
    if (!t) return null;
    const s = instantToLocal(t.startAt.getTime(), timeZone);
    const e = instantToLocal(t.endAt.getTime(), timeZone);
    return { targetType: "trip", targetId: t.id, version: t.version, startDate: s.toPlainDate().toString(), startTime: clock(s), endDate: e.toPlainDate().toString(), endTime: clock(e), recurring: false };
  }
  if (type === "holiday") {
    const [h] = await db.select().from(holidayPeriods).where(and(eq(holidayPeriods.id, id), eq(holidayPeriods.householdId, householdId), isNull(holidayPeriods.archivedAt)));
    if (!h) return null;
    return { targetType: "holiday", targetId: h.id, version: h.version, startDate: h.startDate, startTime: null, endDate: addDays(h.endDateExclusive, -1), endTime: null, recurring: false };
  }
  const [j] = await db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.householdId, householdId), isNull(jobs.archivedAt)));
  if (!j) return null;
  return { targetType: "job", targetId: j.id, version: j.version, startDate: j.startsOn, startTime: j.dueTime, endDate: j.startsOn, endTime: null, recurring: j.cadence !== "once" };
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

const sameAsDiary = (i: DeskCheckInput, t: DeskTarget) =>
  t.startDate === i.startDate && t.startTime === i.startTime && (i.endDate === undefined || t.endDate === i.endDate) && (i.kind !== "event" && i.kind !== "trip" ? true : t.endTime === i.endTime);

export async function deskStatuses(db: DbOrTx, householdId: string, viewer: Actor, items: DeskCheckInput[]): Promise<DeskStatus[]> {
  const [household] = await db.select({ timeZone: households.timeZone }).from(households).where(eq(households.id, householdId));
  const rows = await visibleRows(db, householdId, viewer.accountId, { identity: items.map((x) => x.identityKey), series: items.map((x) => x.seriesKey) });
  const current = new Map<string, DeskTarget | null>();
  for (const { row } of rows) current.set(row.id, await deskTarget(db, householdId, viewer.accountId, household.timeZone, row.targetType, row.targetId));
  const now = (r: (typeof rows)[number]) => current.get(r.row.id) ?? null;
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
    const exact = rows.find((r) => r.row.identityKey === i.identityKey && now(r));
    if (exact) {
      const t = now(exact)!;
      // "Already there" only if the letter matches the fingerprint taken when it was added AND the diary still says the same.
      return exact.row.detailKey === i.detailKey && sameAsDiary(i, t)
        ? { ref: i.ref, status: "added", by: by(exact), on: on(exact) }
        : { ref: i.ref, status: "changed", by: by(exact), on: on(exact), current: t };
    }
    // The same thing at another time or nearby date that this letter doesn't also list: another session, or a move.
    const near = rows
      .filter((r) => r.row.seriesKey === i.seriesKey && now(r) && !listed.has(r.row.identityKey) && r.row.startDate >= addDays(i.startDate, -60) && r.row.startDate <= addDays(i.startDate, 60))
      .map((r) => now(r)!)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? "").localeCompare(b.startTime ?? ""))
      .slice(0, 5);
    if (near.length) return { ref: i.ref, status: "possible", sameDay: near.some((t) => t.startDate === i.startDate), candidates: near };
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
