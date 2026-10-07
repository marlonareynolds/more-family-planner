import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  acceptances,
  accounts,
  calendarFeeds,
  careArrangements,
  careRequirements,
  checkins,
  children,
  expenses,
  feedback,
  helpers,
  highlights,
  households,
  invitations,
  memberships,
  moments,
  notifications,
  paymentTransactions,
  preparationTasks,
  rituals,
  weekPlans,
} from "@/db/schema";
import { cadenceLabel } from "@/domain/rituals";
import { planningWeekKey } from "@/domain/reach";
import { canSeeDetails, findConflicts, type Busy } from "@/domain/availability";
import { coverageFor, groupCoverage, type CareArrangement, type CoverageState } from "@/domain/care";
import { DomainError } from "@/domain/errors";
import type { Interval } from "@/domain/intervals";
import { summarise, type ExpenseSummary } from "@/domain/money";
import { hiddenReason, isAgreed, latestDecision, readiness, stageLabel, type Decision, type ReadinessGap } from "@/domain/moments";
import { addDays, instantToLocalDate, isWeekKey, startOfLocalDate, weekKeyFor } from "@/domain/time";
import type { Actor } from "../auth";
import type { PlaceView } from "@/lib/places";
import { placesFor } from "./places";
import { loadBusy, loadEventOccurrences, loadTrips } from "./busy";
import { tripCareNeeds } from "@/domain/trips";
import { STALE_AFTER_MS } from "../calendar-sync";
import { bankHoliday } from "@/lib/bank-holidays";

/**
 * The viewer-specific week projection (spec 12.2 GET /weeks/{weekKey}).
 * Everything here is filtered for the signed-in adult: a partner's private
 * items appear only as "Busy", private drafts not at all, and no raw
 * check-in answer or reflection is ever included (INV-01, INV-11).
 */

export interface Person {
  id: string;
  displayName: string;
}

export interface WeekEvent {
  kind: "event";
  id: string;
  recurrenceId: string | null;
  recurring: boolean;
  title: string;
  notes: string;
  location: string;
  start: number;
  end: number;
  allDay: boolean;
  adultIds: string[];
  childIds: string[];
  ownerId: string;
  mine: boolean;
  visibility: "shared" | "busy_only" | "private";
  detailsHidden: boolean;
  travelBeforeMinutes: number;
  travelAfterMinutes: number;
  version: number;
  localStart: string;
  durationMinutes: number;
  rule: unknown;
  /** Imported from a connected calendar: read-only here. Label shown to its owner only. */
  imported: boolean;
  importedFrom: string | null;
}

/** A connected calendar's health. Partners see only that it exists and whether it's current. */
export interface CalendarView {
  id: string;
  ownerId: string;
  mine: boolean;
  label: string;
  visibility: "shared" | "busy_only" | "private";
  version: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  eventCount: number;
  stale: boolean;
  /** "ics" for a read-only link; a provider for a signed-in, two-way account. */
  provider: "ics" | "google" | "microsoft";
  /** More's plans are written back to it as "Busy". Owner only. */
  writeBusy: boolean;
}

export interface MomentView {
  kind: "moment";
  id: string;
  momentKind: "me" | "us" | "family";
  title: string;
  notes: string;
  location: string;
  activityKey: string | null;
  start: number;
  end: number;
  travelBeforeMinutes: number;
  travelAfterMinutes: number;
  organiserId: string;
  participantIds: string[];
  childIds: string[];
  needsCare: boolean;
  budgetMinor: number | null;
  surprise: boolean;
  surpriseHidden: boolean;
  /** Title, notes, place and tasks withheld from this viewer (surprise or someone else's me-time). */
  detailsHidden: boolean;
  lifecycle: "draft" | "planned" | "completed" | "cancelled";
  sharing: "private" | "shared";
  materialVersion: number;
  version: number;
  review: "current" | "needs_review";
  reviewReason: string | null;
  agreed: boolean;
  decisions: Record<string, Decision | null>;
  myDecision: Decision | null;
  ready: boolean;
  missing: ReadinessGap[];
  stage: string;
  careState: CoverageState | "not_needed";
  conflicts: { personId?: string; start: number; end: number; title?: string }[];
  tasks: { id: string; title: string; ownerId: string; state: "open" | "done"; version: number }[];
  myFeedbackSaved: boolean;
  expenseId: string | null;
  ritualId: string | null;
  chosenByChildId: string | null;
  /** One-line shared memories, visible to everyone in the plan. */
  highlights: { authorId: string; authorName: string; text: string; mine: boolean }[];
}

export interface RitualView {
  id: string;
  kind: "me" | "us" | "family";
  title: string;
  label: string;
  cadence: "weekly" | "fortnightly" | "monthly";
  startsOn: string;
  startTime: string;
  durationMinutes: number;
  organiserId: string;
  participantIds: string[];
  childIds: string[];
  agreedBy: string[];
  awaitingMe: boolean;
  active: boolean;
  detailsHidden: boolean;
  version: number;
}

export interface CareDay {
  date: string;
  groups: {
    childIds: string[];
    state: CoverageState;
    reason: string;
    gaps: Interval[];
    arrangements: ArrangementView[];
  }[];
}

export interface ArrangementView {
  id: string;
  kind: "parent" | "external" | "not_needed";
  responsibleAccountId: string | null;
  providerName: string | null;
  childIds: string[];
  start: number;
  end: number;
  state: "proposed" | "confirmed" | "declined";
  version: number;
  note: string;
  awaitingMe: boolean;
}

export interface ExpenseView extends ExpenseSummary {
  id: string;
  label: string;
  sourceType: "moment" | "care" | "other";
  sourceId: string | null;
  activityDate: string;
  version: number;
}

export interface AttentionItem {
  key: string;
  priority: number;
  text: string;
  action: "respond" | "review" | "task" | "care" | "care-gap" | "reflect" | "complete" | "checkin" | "invite" | "calendar" | "date-ahead" | "ritual" | "plan-week";
  targetId?: string;
  date?: string;
}

export interface WeekView {
  me: Person;
  household: {
    id: string;
    name: string;
    timeZone: string;
    membershipRevision: number;
    scheduleRevision: number;
    version: number;
  };
  adults: Person[];
  children: { id: string; preferredName: string; ageBand: string; needs: string; version: number }[];
  openInvite: { id: string; expiresAt: string } | null;
  weekKey: string;
  days: string[];
  events: WeekEvent[];
  moments: MomentView[];
  care: CareDay[];
  careAwaitingMe: ArrangementView[];
  expenses: ExpenseView[];
  money: { estimateMinor: number; committedMinor: number; netPaidMinor: number };
  attention: AttentionItem[];
  notifications: { id: string; text: string; createdAt: string; read: boolean; sourceType: string | null; sourceId: string | null }[];
  checkinDone: boolean;
  calendars: CalendarView[];
  /** Public holiday names by date: markers only, not proof anyone is off. */
  markers: Record<string, string>;
  rituals: RitualView[];
  /** The household's village: people who help with the children. */
  helpers: { id: string; name: string; relation: string; phone: string; version: number }[];
  /** The week the household is planning now, and whether it has been planned. */
  planning: { weekKey: string; planned: boolean };
  /** The household's own local places, offered ahead of general ideas. */
  places: PlaceView[];
  /** Time away overlapping this view, and the next family trip ahead. */
  trips: TripView[];
  nextFamilyTrip: TripView | null;
}

export interface TripView {
  id: string;
  kind: "work" | "personal" | "family";
  title: string;
  destination: string;
  start: number;
  end: number;
  travellerIds: string[];
  childIds: string[];
  organiserId: string;
  version: number;
}

function hiddenLabel(m: MomentView | undefined): string | null {
  if (!m?.detailsHidden) return null;
  return m.surpriseHidden ? "Surprise plan" : "Time for themselves";
}

export async function householdFor(db: Db, actor: Actor) {
  const [row] = await db
    .select({ h: households })
    .from(memberships)
    .innerJoin(households, eq(households.id, memberships.householdId))
    .where(and(eq(memberships.accountId, actor.accountId), isNull(memberships.endsAt), isNull(households.deletedAt)));
  return row?.h ?? null;
}

export async function getWeek(db: Db, actor: Actor, weekKey: string, now = new Date()): Promise<WeekView> {
  if (!isWeekKey(weekKey)) throw new DomainError("VALIDATION", "A week must start on a Monday.");
  return getProjection(db, actor, weekKey, 7, now);
}

/**
 * A viewer-specific projection of `days` local days from `fromDate`.
 * Reads are bounded by this horizon, never by lifetime history (INV-13).
 */
export async function getProjection(db: Db, actor: Actor, fromDate: string, days: number, now = new Date()): Promise<WeekView> {
  const household = await householdFor(db, actor);
  if (!household) throw new DomainError("NOT_FOUND", "You are not in a household yet.");
  const tz = household.timeZone;
  const weekKey = fromDate;
  const dayList = Array.from({ length: days }, (_, i) => addDays(fromDate, i));
  const horizon = { start: startOfLocalDate(fromDate, tz), end: startOfLocalDate(addDays(fromDate, days), tz) };
  const viewer = actor.accountId;

  const adults = await db
    .select({ id: accounts.id, displayName: accounts.displayName })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(eq(memberships.householdId, household.id), isNull(memberships.endsAt)))
    .orderBy(memberships.startsAt);
  const adultIds = adults.map((a) => a.id);
  const kids = await db
    .select({ id: children.id, preferredName: children.preferredName, ageBand: children.ageBand, needs: children.needs, version: children.version })
    .from(children)
    .where(and(eq(children.householdId, household.id), isNull(children.archivedAt)))
    .orderBy(children.createdAt);
  const [invite] = await db
    .select({ id: invitations.id, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(and(eq(invitations.householdId, household.id), isNull(invitations.revokedAt), isNull(invitations.acceptedAt), gt(invitations.expiresAt, now)));

  // ── Events (masked per viewer) ──
  const occurrences = await loadEventOccurrences(db, household.id, horizon);
  const feedRows = await db.select().from(calendarFeeds).where(eq(calendarFeeds.householdId, household.id));
  const calendars: CalendarView[] = feedRows.map((f) => {
    const mine = f.accountId === viewer;
    return {
      id: f.id,
      ownerId: f.accountId,
      mine,
      label: mine ? f.label : "Calendar",
      visibility: f.visibility,
      version: f.version,
      lastSuccessAt: f.lastSuccessAt?.toISOString() ?? null,
      lastError: mine ? f.lastError : null,
      eventCount: mine ? f.eventCount : 0,
      stale: !f.lastSuccessAt || now.getTime() - f.lastSuccessAt.getTime() > STALE_AFTER_MS,
      provider: f.provider,
      writeBusy: mine && f.writeBusy,
    };
  });
  const eventsOut: WeekEvent[] = [];
  for (const o of occurrences) {
    const r = o.row;
    const mine = r.ownerId === viewer;
    if (r.visibility === "private" && !mine) continue;
    const hidden = !canSeeDetails(r, viewer);
    eventsOut.push({
      kind: "event",
      id: r.id,
      recurrenceId: o.recurrenceId,
      recurring: !!r.rule,
      title: hidden ? "Busy" : r.title,
      notes: hidden ? "" : r.notes,
      location: hidden ? "" : r.location,
      start: o.start,
      end: o.end,
      allDay: r.allDay,
      adultIds: r.adultIds,
      childIds: hidden ? [] : r.childIds,
      ownerId: r.ownerId,
      mine,
      visibility: r.visibility,
      detailsHidden: hidden,
      travelBeforeMinutes: r.travelBeforeMinutes,
      travelAfterMinutes: r.travelAfterMinutes,
      version: r.version,
      localStart: r.localStart,
      durationMinutes: r.durationMinutes,
      rule: hidden ? null : r.rule,
      imported: !!r.feedId,
      importedFrom: mine && r.feedId ? (feedRows.find((f) => f.id === r.feedId)?.label ?? null) : null,
    });
  }

  // ── Moments ──
  const busy = await loadBusy(db, household.id, { start: horizon.start - 86_400_000, end: horizon.end + 86_400_000 });
  const momentRows = await db
    .select()
    .from(moments)
    .where(
      and(
        eq(moments.householdId, household.id),
        lt(moments.startAt, new Date(horizon.end)),
        gt(moments.endAt, new Date(horizon.start)),
        or(eq(moments.sharing, "shared"), eq(moments.organiserId, viewer)),
      ),
    )
    .orderBy(moments.startAt);
  const momentIds = momentRows.map((m) => m.id);
  const accRows = momentIds.length ? await db.select().from(acceptances).where(inArray(acceptances.momentId, momentIds)).orderBy(acceptances.createdAt) : [];
  const taskRows = momentIds.length ? await db.select().from(preparationTasks).where(inArray(preparationTasks.momentId, momentIds)).orderBy(preparationTasks.createdAt) : [];
  const myFeedback = momentIds.length
    ? await db.select({ momentId: feedback.momentId }).from(feedback).where(and(eq(feedback.accountId, viewer), inArray(feedback.momentId, momentIds)))
    : [];
  const feedbackSet = new Set(myFeedback.map((f) => f.momentId));
  const highlightRows = momentIds.length ? await db.select().from(highlights).where(inArray(highlights.momentId, momentIds)).orderBy(highlights.createdAt) : [];

  // ── Care ──
  const reqRows = await db
    .select()
    .from(careRequirements)
    .where(and(eq(careRequirements.householdId, household.id), lt(careRequirements.startAt, new Date(horizon.end)), gt(careRequirements.endAt, new Date(horizon.start))));
  const arrRows = await db
    .select()
    .from(careArrangements)
    .where(and(eq(careArrangements.householdId, household.id), lt(careArrangements.startAt, new Date(horizon.end + 86_400_000)), gt(careArrangements.endAt, new Date(horizon.start - 86_400_000))));
  const arrangements: CareArrangement[] = arrRows.map((a) => ({
    id: a.id,
    kind: a.kind,
    responsibleAccountId: a.responsibleAccountId,
    providerName: a.providerName,
    childIds: a.childIds,
    start: a.startAt.getTime(),
    end: a.endAt.getTime(),
    state: a.state,
  }));
  const arrangementView = (a: (typeof arrRows)[number]): ArrangementView => ({
    id: a.id,
    kind: a.kind,
    responsibleAccountId: a.responsibleAccountId,
    providerName: a.providerName,
    childIds: a.childIds,
    start: a.startAt.getTime(),
    end: a.endAt.getTime(),
    state: a.state,
    version: a.version,
    note: a.note,
    awaitingMe: a.state === "proposed" && a.kind === "parent" && a.responsibleAccountId === viewer,
  });
  const parentBusy = new Map<string, Interval[]>();
  for (const b of busy) {
    if (b.sourceType === "care") continue;
    const list = parentBusy.get(b.personId) ?? [];
    list.push({ start: b.start - (b.travelBeforeMinutes ?? 0) * 60_000, end: b.end + (b.travelAfterMinutes ?? 0) * 60_000 });
    parentBusy.set(b.personId, list);
  }

  type Req = { id: string; childId: string; start: number; end: number; reason: string };
  const requirements: Req[] = reqRows
    .filter((r) => kids.some((k) => k.id === r.childId))
    .map((r) => ({ id: r.id, childId: r.childId, start: r.startAt.getTime(), end: r.endAt.getTime(), reason: r.reason }));

  // ── Time away: travellers are busy (above); children at home need care
  // wherever no adult is left to look after them.
  const tripRows = await loadTrips(db, household.id, horizon);
  const tripsOut: TripView[] = tripRows.map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    destination: t.destination,
    start: t.startAt.getTime(),
    end: t.endAt.getTime(),
    travellerIds: t.travellerIds.filter((id) => adultIds.includes(id)),
    childIds: t.childIds.filter((id) => kids.some((k) => k.id === id)),
    organiserId: t.organiserId,
    version: t.version,
  }));
  const commitments = busy.filter((b) => b.sourceType === "event").map((b) => ({ personId: b.personId, start: b.start, end: b.end, childIds: b.childIds ?? [] }));
  for (const t of tripsOut) {
    const names = t.travellerIds.map((id) => adults.find((a) => a.id === id)?.displayName ?? "Someone");
    const reason = `${names.join(" and ")} away`;
    for (const need of tripCareNeeds({ trip: t, adultIds, childIds: kids.map((k) => k.id), commitments, reason, timeZone: tz })) {
      if (need.end > horizon.start && need.start < horizon.end) requirements.push(need);
    }
  }

  const momentsOut: MomentView[] = [];
  for (const m of momentRows) {
    const hidden = hiddenReason(m, viewer);
    const organiserName = adults.find((a) => a.id === m.organiserId)?.displayName ?? "Your partner";
    const acc = accRows.filter((a) => a.momentId === m.id).map((a) => ({ actorId: a.actorId, materialVersion: a.materialVersion, decision: a.decision }));
    const agreed = m.sharing === "shared" && isAgreed(m.participantIds, adultIds, m.materialVersion, acc);
    const decisions: Record<string, Decision | null> = {};
    for (const p of m.participantIds) decisions[p] = latestDecision(acc, p, m.materialVersion);

    // Children not taking part need care for the whole occupied time (AT-04:
    // computed from the current children, so a new child is never assumed covered).
    let careState: MomentView["careState"] = "not_needed";
    const occupiedStart = m.startAt.getTime() - m.travelBeforeMinutes * 60_000;
    const occupiedEnd = m.endAt.getTime() + m.travelAfterMinutes * 60_000;
    if (m.needsCare && m.lifecycle !== "cancelled") {
      const states = kids
        .filter((k) => !m.childIds.includes(k.id))
        .map((k) => {
          const req = { id: `moment:${m.id}:${k.id}`, childId: k.id, start: occupiedStart, end: occupiedEnd };
          if (m.lifecycle !== "completed") requirements.push({ ...req, reason: hidden === "me_time" ? `${organiserName} has time to themselves` : hidden ? "Plan together" : m.title });
          return coverageFor(req, arrangements, parentBusy).state;
        });
      careState = states.every((s) => s === "covered") ? "covered" : states.some((s) => s !== "unresolved") ? "partly_covered" : "unresolved";
    }
    const conflicts =
      m.lifecycle === "cancelled" || m.lifecycle === "completed"
        ? []
        : findConflicts({ personIds: m.participantIds, start: occupiedStart, end: occupiedEnd, excludeSourceIds: [m.id] }, busy, viewer).map((c) => ({
            personId: c.personId,
            start: c.start,
            end: c.end,
            title: c.title,
          }));
    const tasks = taskRows.filter((t) => t.momentId === m.id);
    const ready = readiness({
      agreed,
      careCovered: careState === "covered" || careState === "not_needed",
      needsCare: m.needsCare,
      openTasks: tasks.filter((t) => t.state === "open").length,
      conflicts: conflicts.length,
    });
    const surpriseHidden = hidden === "surprise";
    momentsOut.push({
      kind: "moment",
      id: m.id,
      momentKind: m.kind,
      title: hidden === "me_time" ? `${organiserName}: time for themselves` : hidden ? `A surprise from ${organiserName}` : m.title,
      notes: hidden ? "" : m.notes,
      location: hidden ? "" : m.location,
      activityKey: hidden ? null : m.activityKey,
      start: m.startAt.getTime(),
      end: m.endAt.getTime(),
      travelBeforeMinutes: m.travelBeforeMinutes,
      travelAfterMinutes: m.travelAfterMinutes,
      organiserId: m.organiserId,
      participantIds: m.participantIds,
      childIds: m.childIds,
      needsCare: m.needsCare,
      budgetMinor: m.budgetMinor,
      surprise: m.surprise,
      surpriseHidden,
      detailsHidden: hidden !== null,
      lifecycle: m.lifecycle,
      sharing: m.sharing,
      materialVersion: m.materialVersion,
      version: m.version,
      review: m.review,
      reviewReason: m.reviewReason,
      agreed,
      decisions,
      myDecision: decisions[viewer] ?? null,
      ready: ready.ready,
      missing: ready.missing,
      stage: stageLabel({ lifecycle: m.lifecycle, sharing: m.sharing, agreed, ready: ready.ready }),
      careState,
      conflicts,
      tasks: hidden ? [] : tasks.map((t) => ({ id: t.id, title: t.title, ownerId: t.ownerId, state: t.state, version: t.version })),
      myFeedbackSaved: feedbackSet.has(m.id),
      expenseId: null,
      ritualId: m.ritualId,
      chosenByChildId: hidden ? null : m.chosenByChildId,
      // Highlights belong to the people in the plan (and the whole family's plans to both adults).
      highlights:
        hidden || !(m.participantIds.includes(viewer) || m.kind === "family")
          ? []
          : highlightRows
              .filter((h) => h.momentId === m.id)
              .map((h) => ({ authorId: h.accountId, authorName: adults.find((a) => a.id === h.accountId)?.displayName ?? "Someone", text: h.text, mine: h.accountId === viewer })),
    });
  }

  // Coverage per child, grouped per day (spec 6.3: group children, split only real differences).
  const careDays: CareDay[] = [];
  for (const date of dayList) {
    const reqs = requirements.filter((r) => instantToLocalDate(r.start, tz) === date);
    if (!reqs.length) continue;
    const byReason = new Map<string, Req[]>();
    for (const r of reqs) byReason.set(`${r.reason}|${r.start}|${r.end}`, [...(byReason.get(`${r.reason}|${r.start}|${r.end}`) ?? []), r]);
    const groups: CareDay["groups"] = [];
    for (const list of byReason.values()) {
      const cov = list.map((r) => coverageFor({ id: r.id, childId: r.childId, start: r.start, end: r.end }, arrangements, parentBusy));
      for (const g of groupCoverage(cov)) {
        const sample = cov.find((c) => c.childId === g.childIds[0])!;
        groups.push({
          childIds: g.childIds,
          state: g.state,
          reason: list[0].reason,
          gaps: sample.gaps,
          arrangements: arrRows.filter((a) => g.arrangementIds.includes(a.id)).map(arrangementView),
        });
      }
    }
    careDays.push({ date, groups });
  }
  const careAwaitingMe = arrRows.map(arrangementView).filter((a) => a.awaitingMe);

  // ── Money: one row per real cost, on the activity-week basis ──
  const expenseRows = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.householdId, household.id), sql`${expenses.activityDate} >= ${weekKey}`, sql`${expenses.activityDate} < ${addDays(weekKey, days)}`));
  const visibleMomentIds = new Set(momentsOut.map((m) => m.id));
  const hiddenDraftIds = new Set(
    expenseRows.filter((e) => e.sourceType === "moment" && e.sourceId && !visibleMomentIds.has(e.sourceId)).map((e) => e.sourceId!),
  );
  const txRows = expenseRows.length
    ? await db.select().from(paymentTransactions).where(inArray(paymentTransactions.expenseId, expenseRows.map((e) => e.id)))
    : [];
  const expensesOut: ExpenseView[] = expenseRows
    .filter((e) => !(e.sourceId && hiddenDraftIds.has(e.sourceId)))
    .map((e) => ({
      id: e.id,
      label: hiddenLabel(e.sourceType === "moment" ? momentsOut.find((m) => m.id === e.sourceId) : undefined) ?? e.label,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      activityDate: e.activityDate,
      version: e.version,
      ...summarise(e, txRows.filter((t) => t.expenseId === e.id)),
    }));
  for (const m of momentsOut) m.expenseId = expensesOut.find((e) => e.sourceType === "moment" && e.sourceId === m.id)?.id ?? null;
  const money = {
    estimateMinor: expensesOut.reduce((s, e) => s + (e.estimateMinor ?? 0), 0),
    committedMinor: expensesOut.reduce((s, e) => s + (e.committedMinor ?? 0), 0),
    netPaidMinor: expensesOut.reduce((s, e) => s + e.netPaidMinor, 0),
  };

  // ── Notifications and check-in ──
  const notes = await db
    .select()
    .from(notifications)
    .where(eq(notifications.accountId, viewer))
    .orderBy(desc(notifications.createdAt))
    .limit(20);
  const [checkin] = await db
    .select({ id: checkins.id })
    .from(checkins)
    .where(and(eq(checkins.accountId, viewer), eq(checkins.weekKey, weekKeyFor(fromDate))));

  const datesAhead = await importantDatesAhead(db, household.id, viewer, now, tz);

  // ── Rituals and the weekly plan ──
  const ritualRows = await db.select().from(rituals).where(and(eq(rituals.householdId, household.id), isNull(rituals.endedAt))).orderBy(rituals.createdAt);
  const ritualsOut: RitualView[] = ritualRows
    .filter((r) => r.kind !== "me" || r.organiserId === viewer || r.agreedBy.length === r.participantIds.length)
    .map((r) => {
      const hidden = r.kind === "me" && r.organiserId !== viewer;
      const organiserName = adults.find((a) => a.id === r.organiserId)?.displayName ?? "Your partner";
      return {
        id: r.id,
        kind: r.kind,
        title: hidden ? `${organiserName}: time for themselves` : r.title,
        label: cadenceLabel(r.cadence, r.startsOn),
        cadence: r.cadence,
        startsOn: r.startsOn,
        startTime: r.startTime,
        durationMinutes: r.durationMinutes,
        organiserId: r.organiserId,
        participantIds: r.participantIds,
        childIds: r.childIds,
        agreedBy: r.agreedBy,
        awaitingMe: r.participantIds.includes(viewer) && !r.agreedBy.includes(viewer),
        active: r.participantIds.every((p) => r.agreedBy.includes(p)),
        detailsHidden: hidden,
        version: r.version,
      };
    });
  const helperRows = await db.select().from(helpers).where(and(eq(helpers.householdId, household.id), isNull(helpers.archivedAt))).orderBy(helpers.createdAt);
  const planningKey = planningWeekKey(now.getTime(), tz);
  const [plan] = await db.select({ k: weekPlans.weekKey }).from(weekPlans).where(and(eq(weekPlans.householdId, household.id), eq(weekPlans.weekKey, planningKey))).limit(1);
  const planning = { weekKey: planningKey, planned: !!plan };

  const attention = buildAttention({ viewer, momentsOut, careDays, careAwaitingMe, kids, adults, now, tz, checkinDone: !!checkin, openInvite: !!invite, calendars, datesAhead, rituals: ritualsOut, planning });

  return {
    me: { id: viewer, displayName: adults.find((a) => a.id === viewer)?.displayName ?? actor.displayName },
    household: {
      id: household.id,
      name: household.name,
      timeZone: tz,
      membershipRevision: household.membershipRevision,
      scheduleRevision: household.scheduleRevision,
      version: household.version,
    },
    adults,
    children: kids,
    openInvite: invite ? { id: invite.id, expiresAt: invite.expiresAt.toISOString() } : null,
    weekKey,
    days: dayList,
    events: eventsOut,
    moments: momentsOut,
    care: careDays,
    careAwaitingMe,
    expenses: expensesOut,
    money,
    attention,
    notifications: notes.map((n) => ({
      id: n.id,
      text: n.text,
      createdAt: n.createdAt.toISOString(),
      read: !!n.readAt,
      sourceType: n.sourceType,
      sourceId: n.sourceId,
    })),
    checkinDone: !!checkin,
    calendars,
    rituals: ritualsOut,
    helpers: helperRows.map((h) => ({ id: h.id, name: h.name, relation: h.relation, phone: h.phone, version: h.version })),
    planning,
    places: await placesFor(db, household.id),
    trips: tripsOut,
    nextFamilyTrip: await nextFamilyTrip(db, household.id, now),
    markers: Object.fromEntries(dayList.flatMap((d) => {
      const name = bankHoliday(d, tz);
      return name ? [[d, name]] : [];
    })),
  };
}

/**
 * Yearly all-day dates (birthdays, anniversaries) coming up in the next two
 * weeks that this viewer can see, unless a plan they know of already exists
 * that day (spec 8.2: recurring important dates). A private hint, only for an
 * adult who turned it on: partners are never nudged together, and one
 * partner's private draft never changes what the other is shown.
 */
async function importantDatesAhead(db: Db, householdId: string, viewer: string, now: Date, tz: string) {
  const [me] = await db.select({ dateHints: accounts.dateHints }).from(accounts).where(eq(accounts.id, viewer));
  if (!me?.dateHints) return [];
  const start = startOfLocalDate(instantToLocalDate(now.getTime(), tz), tz);
  const horizon = { start, end: start + 15 * 86_400_000 };
  const occ = await loadEventOccurrences(db, householdId, horizon);
  const planned = await db
    .select({ startAt: moments.startAt })
    .from(moments)
    .where(and(eq(moments.householdId, householdId), gt(moments.endAt, new Date(horizon.start)), lt(moments.startAt, new Date(horizon.end)), sql`${moments.lifecycle} <> 'cancelled'`, sql`${moments.kind} <> 'me'`, sql`(${moments.organiserId} = ${viewer} or ${moments.sharing} = 'shared')`));
  const plannedDays = new Set(planned.map((m) => instantToLocalDate(m.startAt.getTime(), tz)));
  const today = instantToLocalDate(now.getTime(), tz);
  const out: { id: string; title: string; date: string; days: number }[] = [];
  for (const o of occ) {
    const rule = o.row.rule as { freq?: string } | null;
    if (!o.row.allDay || rule?.freq !== "YEARLY" || o.row.feedId) continue;
    if (o.row.ownerId !== viewer && !canSeeDetails(o.row, viewer)) continue;
    const date = instantToLocalDate(o.start, tz);
    if (date < today || plannedDays.has(date)) continue;
    const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
    if (days <= 14) out.push({ id: o.eventId, title: o.row.title, date, days });
  }
  return out.sort((a, b) => a.days - b.days).slice(0, 3);
}

function buildAttention(input: {
  viewer: string;
  momentsOut: MomentView[];
  careDays: CareDay[];
  careAwaitingMe: ArrangementView[];
  kids: { id: string; preferredName: string }[];
  adults: Person[];
  now: Date;
  tz: string;
  checkinDone: boolean;
  openInvite: boolean;
  calendars: CalendarView[];
  datesAhead: { id: string; title: string; date: string; days: number }[];
  rituals: RitualView[];
  planning: { weekKey: string; planned: boolean };
}): AttentionItem[] {
  const { viewer, now } = input;
  const out: AttentionItem[] = [];
  const names = (ids: string[]) => ids.map((id) => input.kids.find((k) => k.id === id)?.preferredName ?? "a child").join(", ");
  const nowMs = now.getTime();

  for (const m of input.momentsOut) {
    const upcoming = m.end > nowMs && m.lifecycle === "planned";
    if (upcoming && m.sharing === "shared" && m.participantIds.includes(viewer) && m.myDecision !== "accepted") {
      out.push({ key: `respond:${m.id}:${m.materialVersion}`, priority: 1, text: `Answer “${m.title}”`, action: "respond", targetId: m.id });
    }
    if (m.review === "needs_review" && m.lifecycle !== "cancelled" && m.end > nowMs) {
      out.push({ key: `review:${m.id}`, priority: 1, text: `Check “${m.title}”: ${m.reviewReason ?? "something changed"}`, action: "review", targetId: m.id });
    }
    if (upcoming) {
      for (const t of m.tasks.filter((t) => t.ownerId === viewer && t.state === "open")) {
        out.push({ key: `task:${t.id}`, priority: 2, text: `${t.title} (for “${m.title}”)`, action: "task", targetId: m.id });
      }
    }
    if (m.lifecycle === "planned" && m.end <= nowMs && m.participantIds.includes(viewer)) {
      out.push({ key: `complete:${m.id}`, priority: 3, text: `Did “${m.title}” happen?`, action: "complete", targetId: m.id });
    }
    if (m.lifecycle === "completed" && m.participantIds.includes(viewer) && !m.myFeedbackSaved) {
      out.push({ key: `reflect:${m.id}`, priority: 4, text: `How was “${m.title}”? (only you see this)`, action: "reflect", targetId: m.id });
    }
  }
  for (const r of input.rituals.filter((r) => r.awaitingMe)) {
    const who = input.adults.find((a) => a.id === r.organiserId)?.displayName ?? "Your partner";
    out.push({ key: `ritual:${r.id}:${r.version}`, priority: 1, text: `${who} suggested “${r.title}”, ${r.label.toLowerCase()}`, action: "ritual", targetId: r.id });
  }
  // Own the weekly planning moment (spec 3.3): from Friday, offer next week.
  if (!input.planning.planned) {
    const dow = new Date(`${instantToLocalDate(nowMs, input.tz)}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow >= 5 || dow === 1) {
      out.push({ key: `plan-week:${input.planning.weekKey}`, priority: 2, text: "Take ten minutes together to plan the week", action: "plan-week" });
    }
  }
  for (const a of input.careAwaitingMe) {
    out.push({ key: `care:${a.id}`, priority: 1, text: `Can you look after ${names(a.childIds)}?`, action: "care", targetId: a.id });
  }
  for (const day of input.careDays) {
    for (const g of day.groups) {
      if (g.state !== "covered" && g.gaps.some((gap) => gap.end > nowMs)) {
        out.push({ key: `gap:${day.date}:${g.childIds.join(",")}:${g.reason}`, priority: 2, text: `${names(g.childIds)} still needs care (${g.reason})`, action: "care-gap", date: day.date });
      }
    }
  }
  // A stale calendar makes availability uncertain (spec 8.11): say so.
  for (const c of input.calendars.filter((c) => c.mine && c.stale && c.lastSuccessAt)) {
    out.push({ key: `calendar:${c.id}`, priority: 3, text: `“${c.label}” hasn't updated since ${c.lastSuccessAt!.slice(0, 10)}, so free time may be wrong`, action: "calendar", targetId: c.id });
  }
  for (const c of input.calendars.filter((c) => c.mine && !c.lastSuccessAt && c.lastError)) {
    out.push({ key: `calendar:${c.id}`, priority: 3, text: `“${c.label}” couldn't be read. Check the link in Settings`, action: "calendar", targetId: c.id });
  }
  for (const d of input.datesAhead) {
    const when = d.days === 0 ? "is today" : d.days === 1 ? "is tomorrow" : `is in ${d.days} days`;
    out.push({ key: `date:${d.id}:${d.date}`, priority: 3, text: `“${d.title}” ${when}. Only you get this reminder.`, action: "date-ahead", targetId: d.id, date: d.date });
  }
  if (input.adults.length < 2 && !input.openInvite) {
    out.push({ key: "invite", priority: 5, text: "Invite your partner when you're ready", action: "invite" });
  }
  if (!input.checkinDone) {
    out.push({ key: "checkin", priority: 6, text: "Optional: a ten-second check-in for this week", action: "checkin" });
  }
  return out.sort((a, b) => a.priority - b.priority);
}

export type { Busy };

/** The next whole-family trip in the coming 90 days, for a countdown. */
async function nextFamilyTrip(db: Db, householdId: string, now: Date): Promise<TripView | null> {
  const rows = await loadTrips(db, householdId, { start: now.getTime() + 86_400_000, end: now.getTime() + 90 * 86_400_000 });
  const t = rows.find((r) => r.kind === "family" && r.startAt.getTime() > now.getTime());
  return t
    ? { id: t.id, kind: t.kind, title: t.title, destination: t.destination, start: t.startAt.getTime(), end: t.endAt.getTime(), travellerIds: t.travellerIds, childIds: t.childIds, organiserId: t.organiserId, version: t.version }
    : null;
}
