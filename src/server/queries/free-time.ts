import { and, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, calendarFeeds, careArrangements, checkins, children, events, holidayPeriods, memberships } from "@/db/schema";
import type { Busy } from "@/domain/availability";
import { coverageFor, type CareArrangement } from "@/domain/care";
import { DomainError } from "@/domain/errors";
import { freeEvenings, suggestTimes, type ArrangedCare, type MomentKind, type SuggestedTime } from "@/domain/free-time";
import type { Interval } from "@/domain/intervals";
import { allAtSchool, usualHours } from "@/domain/usual-hours";
import { bankHoliday } from "@/lib/bank-holidays";
import { addDays, currentWeekKey, instantToLocalDate, startOfLocalDate } from "@/domain/time";
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

/** Everything a free-time search needs about the household over a horizon. */
async function planningContext(db: Db, actor: Actor, kind: MomentKind, now: Date, days: number, duringWork = false) {
  const household = await householdFor(db, actor);
  if (!household) throw new DomainError("NOT_FOUND", "You are not in a household.");
  const adults = await db
    .select({ id: accounts.id, displayName: accounts.displayName })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(eq(memberships.householdId, household.id), isNull(memberships.endsAt)));
  const kids = await db.select({ id: children.id, ageBand: children.ageBand }).from(children).where(and(eq(children.householdId, household.id), isNull(children.archivedAt)));
  const horizon = { start: now.getTime(), end: now.getTime() + (days + 1) * 86_400_000 };
  const usual = await usualHoursFor(db, household, adults.map((a) => a.id), kids, horizon, days);
  // A long lunch together is taken out of the working day, so only then is it left open.
  const busy = [...(await loadBusy(db, household.id, horizon)), ...(duringWork ? [] : usual.work)];
  const participants = kind === "me" ? [actor.accountId] : adults.map((a) => a.id);
  const arrangements = kids.length
    ? (
        await db
          .select()
          .from(careArrangements)
          .where(
            and(
              eq(careArrangements.householdId, household.id),
              ne(careArrangements.state, "declined"),
              lt(careArrangements.startAt, new Date(horizon.end)),
              gt(careArrangements.endAt, new Date(horizon.start)),
            ),
          )
      ).map(
        (a): CareArrangement => ({
          id: a.id,
          kind: a.kind,
          responsibleAccountId: a.responsibleAccountId,
          providerName: a.providerName,
          childIds: a.childIds,
          start: a.startAt.getTime(),
          end: a.endAt.getTime(),
          state: a.state,
        }),
      )
    : [];
  return {
    household,
    adults,
    kids,
    horizon,
    busy,
    participants,
    school: usual.school,
    arrangedCare: atSchoolOr(kids, usual.school, arrangedCareFor(kids.map((k) => k.id), arrangements, busy, participants)),
  };
}

/**
 * School and working hours, assumed until the household says otherwise
 * (review: no cinema at 11:00 on a school day). An adult who has added a
 * working week ("Work" repeating in the diary) or connected a calendar is
 * taken at their word instead; school holidays and INSET days added in
 * Trips and care, and bank holidays, free the children's school day.
 */
async function usualHoursFor(db: Db, household: { id: string; timeZone: string }, adultIds: string[], kids: { id: string; ageBand: string }[], horizon: { start: number; end: number }, days: number) {
  const own = adultIds.length
    ? await db
        .select({ ownerId: events.ownerId })
        .from(events)
        .where(and(eq(events.householdId, household.id), inArray(events.ownerId, adultIds), isNotNull(events.rule), isNull(events.cancelledAt), isNull(events.feedId), ilike(events.title, "work%")))
    : [];
  const feeds = adultIds.length ? await db.select({ accountId: calendarFeeds.accountId }).from(calendarFeeds).where(and(eq(calendarFeeds.householdId, household.id), inArray(calendarFeeds.accountId, adultIds))) : [];
  const told = new Set([...own.map((o) => o.ownerId), ...feeds.map((f) => f.accountId)]);
  const from = instantToLocalDate(horizon.start, household.timeZone);
  const breaks = kids.length
    ? await db
        .select({ startDate: holidayPeriods.startDate, endDateExclusive: holidayPeriods.endDateExclusive, childIds: holidayPeriods.childIds })
        .from(holidayPeriods)
        .where(and(eq(holidayPeriods.householdId, household.id), isNull(holidayPeriods.archivedAt), gt(holidayPeriods.endDateExclusive, from), lt(holidayPeriods.startDate, addDays(from, days + 2))))
    : [];
  return usualHours({
    timeZone: household.timeZone,
    from,
    days: days + 2,
    workers: adultIds.filter((id) => !told.has(id)),
    children: kids,
    breaks,
    dayOff: (date) => !!bankHoliday(date, household.timeZone),
  });
}

/** Children at school for the whole time need nobody else: that care is in place. */
function atSchoolOr(kids: { id: string }[], school: { childId: string; start: number; end: number }[], arranged: (start: number, end: number) => ArrangedCare | null) {
  return (start: number, end: number): ArrangedCare | null => (allAtSchool(kids, school, { start, end }) ? "covered" : arranged(start, end));
}

/**
 * Care already arranged for every child over a time (review R06): a
 * confirmed arrangement covers it, a proposed one is pending, and an
 * adult taking part in the plan can't be its carer.
 */
export function arrangedCareFor(childIds: readonly string[], arrangements: readonly CareArrangement[], busy: readonly Busy[], participants: readonly string[]) {
  return (start: number, end: number): ArrangedCare | null => {
    if (!childIds.length || !arrangements.length) return null;
    const parentBusy = new Map<string, Interval[]>();
    for (const b of busy) if (b.sourceType !== "care") parentBusy.set(b.personId, [...(parentBusy.get(b.personId) ?? []), { start: b.start, end: b.end }]);
    for (const p of participants) parentBusy.set(p, [...(parentBusy.get(p) ?? []), { start, end }]);
    const confirmed = childIds.map((c) => coverageFor({ id: c, childId: c, start, end }, arrangements, parentBusy).state);
    if (confirmed.every((st) => st === "covered")) return "covered";
    const hoped = arrangements.map((a) => (a.state === "proposed" ? { ...a, state: "confirmed" as const } : a));
    const ifYes = childIds.map((c) => coverageFor({ id: c, childId: c, start, end }, hoped, parentBusy).state);
    if (ifYes.every((st) => st === "covered")) return "pending";
    return ifYes.some((st) => st !== "unresolved") ? "partly" : null;
  };
}

export async function freeTimesFor(db: Db, actor: Actor, kind: MomentKind, minutes: number, now = new Date(), days = 14, startBetween?: readonly [string, string], opts: { duringWork?: boolean } = {}): Promise<FreeTimes> {
  const { household, adults, kids, horizon, busy, participants, arrangedCare, school } = await planningContext(db, actor, kind, now, days, opts.duringWork);
  const childBusy =
    kind === "family"
      ? [
          ...(await loadEventOccurrences(db, household.id, horizon)).filter((o) => o.row.childIds.length > 0).map((o) => ({ start: o.start, end: o.end })),
          ...school.map((s) => ({ start: s.start, end: s.end })),
        ]
      : [];
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
    dayOff: (date) => !!bankHoliday(date, household.timeZone),
    startBetween,
    workdaysOnly: opts.duringWork,
    arrangedCare,
    familyDayEnd: household.eveningEnds,
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

/**
 * The first evening start on each day of a week that is free for both
 * adults (blueprint: "free together" windows). A fact both partners see;
 * what to do with it stays each person's own.
 */
export async function freeTogetherIn(db: Db, actor: Actor, week: { weekKey: string; household: { timeZone: string }; adults: unknown[] }, now = new Date()): Promise<Record<string, { startTime: string; care: SuggestedTime["care"] }>> {
  const out: Record<string, { startTime: string; care: SuggestedTime["care"] }> = {};
  const tz = week.household.timeZone;
  const weekEnd = startOfLocalDate(addDays(week.weekKey, 7), tz);
  const from = Math.max(now.getTime(), startOfLocalDate(week.weekKey, tz));
  if (week.adults.length < 2 || from >= weekEnd) return out;
  const days = Math.ceil((weekEnd - from) / 86_400_000) + 1;
  const ctx = await planningContext(db, actor, "us", new Date(from), days);
  // After the children's bedtime if the household has said one; a bedtime is
  // never taken as care, so the children's state below is unchanged by it.
  const start = ctx.household.bedtime && ctx.household.bedtime > "18:30" ? ctx.household.bedtime : "18:30";
  const evenings = freeEvenings({
    now: from,
    timeZone: tz,
    days,
    minutes: 150,
    from: start,
    to: start > "20:00" ? start : "20:00",
    participantIds: ctx.participants,
    carerIds: [],
    hasChildren: ctx.kids.length > 0,
    busy: ctx.busy,
    arrangedCare: ctx.arrangedCare,
  });
  for (const s of evenings) if (s.start < weekEnd) out[s.date] = { startTime: s.startTime, care: s.care };
  return out;
}
