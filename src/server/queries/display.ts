import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, childWishes, children, displayLinks, households, memberships, outbox } from "@/db/schema";
import type { DayWeather } from "@/domain/weather";
import { instantToLocal, instantToLocalDate, weekKeyFor } from "@/domain/time";
import { CATALOGUE, type Activity } from "@/lib/catalogue";
import { placeActivities } from "@/lib/places";
import { hashDisplayToken } from "../commands/display";
import { getProjection, type WeekView } from "./week";

/**
 * The family's shared screens (blueprint: kitchen display, a child's view).
 * Built from the household projection but cut down to what a child may
 * read over a parent's shoulder: family plans, the children's own
 * activities, who is looking after them, and who is away. Never plans for
 * the adults, notes, money, or anything private.
 */

export interface DisplayItem {
  key: string;
  kind: "family" | "activity" | "care" | "away" | "trip";
  /** "HH:MM", or null for all day. */
  time: string | null;
  endTime: string | null;
  title: string;
  /** Children it involves, by first name. */
  children: string[];
}

export interface DisplayDay {
  date: string;
  marker: string | null;
  weather: DayWeather | null;
  items: DisplayItem[];
}

export interface DisplayView {
  mode: "kitchen" | "child";
  householdName: string;
  timeZone: string;
  today: string;
  child: { id: string; name: string } | null;
  days: DisplayDay[];
  /** The next whole-family trip, as sleeps to go. */
  countdown: { title: string; sleeps: number } | null;
  /** Whose turn it is to choose a family plan. */
  turn: { childId: string; name: string } | null;
  /** Child's view only: their pick waiting for the adults, or ideas to pick from when it's their turn. */
  wish: string | null;
  choices: { key: string; title: string; summary: string }[];
}

export async function loadDisplayLink(db: Db, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await db
    .select({ link: displayLinks, household: households })
    .from(displayLinks)
    .innerJoin(households, eq(households.id, displayLinks.householdId))
    .where(and(eq(displayLinks.tokenHash, hashDisplayToken(token)), isNull(displayLinks.revokedAt), isNull(households.deletedAt)));
  if (!row) return null;
  if (row.link.childId) {
    const [kid] = await db.select().from(children).where(and(eq(children.id, row.link.childId), isNull(children.archivedAt)));
    if (!kid) return null;
    return { ...row, child: kid };
  }
  return { ...row, child: null };
}

/** Family ideas a child can choose from: ones for their age, rotating weekly. */
export function choicesFor(ageBand: string, week: string, places: Activity[] = []): Activity[] {
  const pool = [...places, ...CATALOGUE.filter((a) => a.kind === "family" && (!a.ages || a.ages.includes(ageBand as never)) && a.key !== "fam-one-to-one")];
  if (pool.length <= 3) return pool;
  let h = 0;
  for (const c of week) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const start = h % pool.length;
  return [0, 1, 2].map((i) => pool[(start + i * Math.max(1, Math.floor(pool.length / 3))) % pool.length]);
}

const DAYS_SHOWN = { kitchen: 7, child: 3 } as const;

export async function displayView(db: Db, token: string, now = new Date()): Promise<DisplayView | null> {
  const found = await loadDisplayLink(db, token);
  if (!found) return null;
  const { link, household } = found;
  // Read as one of the adults, then keep only what the whole family may see.
  const [adult] = await db
    .select({ id: accounts.id, displayName: accounts.displayName })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(eq(memberships.householdId, household.id), isNull(memberships.endsAt)))
    .orderBy(asc(memberships.startsAt))
    .limit(1);
  if (!adult) return null;
  if (!link.lastSeenAt || now.getTime() - link.lastSeenAt.getTime() > 3_600_000) {
    await db.update(displayLinks).set({ lastSeenAt: now }).where(eq(displayLinks.id, link.id));
  }
  const tz = household.timeZone;
  const today = instantToLocalDate(now.getTime(), tz);
  const mode = found.child ? "child" : "kitchen";
  const view = await getProjection(db, { accountId: adult.id, displayName: adult.displayName }, today, DAYS_SHOWN[mode], now);
  const childId = found.child?.id ?? null;
  const days = buildDays(view, childId);

  const kidName = (id: string) => view.children.find((k) => k.id === id)?.preferredName ?? "";
  const trip = view.nextFamilyTrip && (!childId || view.nextFamilyTrip.childIds.includes(childId)) ? view.nextFamilyTrip : null;
  const sleeps = trip ? Math.round((Date.parse(`${instantToLocalDate(trip.start, tz)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) : 0;
  const turn = view.turnToChoose ? { childId: view.turnToChoose, name: kidName(view.turnToChoose) } : null;

  let wish: string | null = null;
  let choices: DisplayView["choices"] = [];
  if (found.child) {
    const [open] = await db.select().from(childWishes).where(and(eq(childWishes.childId, found.child.id), isNull(childWishes.handledAt)));
    wish = open?.title ?? null;
    if (!wish && turn?.childId === found.child.id) {
      choices = choicesFor(found.child.ageBand, weekKeyFor(today), placeActivities(view.places, "family")).map((a) => ({ key: a.key, title: a.title, summary: a.summary }));
    }
  }

  return {
    mode,
    householdName: household.name,
    timeZone: tz,
    today,
    child: found.child ? { id: found.child.id, name: found.child.preferredName } : null,
    days,
    countdown: trip && sleeps > 0 ? { title: trip.title, sleeps } : null,
    turn,
    wish,
    choices,
  };
}

function buildDays(view: WeekView, childId: string | null): DisplayDay[] {
  const tz = view.household.timeZone;
  const hm = (ms: number) => instantToLocal(ms, tz).toString().slice(11, 16);
  const kidNames = (ids: string[]) => ids.map((id) => view.children.find((k) => k.id === id)?.preferredName).filter((n): n is string => !!n);
  const adultName = (id: string | null) => (id ? view.adults.find((a) => a.id === id)?.displayName.split(" ")[0] : null) ?? null;
  const forChild = (ids: readonly string[]) => !childId || ids.includes(childId);
  const out: DisplayDay[] = [];

  for (const date of view.days) {
    const items: DisplayItem[] = [];
    const onDay = (start: number, end: number) => instantToLocalDate(start, tz) <= date && instantToLocalDate(end - 1, tz) >= date;
    const span = (start: number, end: number) => ({
      time: instantToLocalDate(start, tz) === date ? hm(start) : null,
      endTime: instantToLocalDate(end - 1, tz) === date ? hm(end) : null,
    });

    for (const m of view.moments) {
      if (m.momentKind !== "family" || !m.agreed || (m.lifecycle !== "planned" && m.lifecycle !== "completed") || !onDay(m.start, m.end)) continue;
      if (!forChild(m.childIds)) continue;
      items.push({ key: `m:${m.id}`, kind: "family", ...span(m.start, m.end), title: m.surprise && m.lifecycle !== "completed" ? "A surprise" : m.title, children: kidNames(m.childIds) });
    }
    for (const e of view.events) {
      if (!e.childIds.length || e.visibility !== "shared" || e.detailsHidden || !onDay(e.start, e.end) || !forChild(e.childIds)) continue;
      items.push({ key: `e:${e.id}:${e.start}`, kind: "activity", ...(e.allDay ? { time: null, endTime: null } : span(e.start, e.end)), title: e.title, children: kidNames(e.childIds) });
    }
    for (const g of view.care.find((c) => c.date === date)?.groups ?? []) {
      for (const a of g.arrangements) {
        if (a.state !== "confirmed" || a.kind === "not_needed" || !forChild(a.childIds)) continue;
        const who = a.kind === "parent" ? adultName(a.responsibleAccountId) : a.providerName;
        if (!who) continue;
        items.push({ key: `c:${a.id}:${date}`, kind: "care", ...span(a.start, a.end), title: `${who} is with ${childId ? "you" : kidNames(a.childIds).join(" and ")}`, children: kidNames(a.childIds) });
      }
    }
    for (const t of view.trips) {
      if (!onDay(t.start, t.end)) continue;
      if (t.kind === "family") {
        if (!forChild(t.childIds)) continue;
        items.push({ key: `t:${t.id}:${date}`, kind: "trip", time: null, endTime: null, title: t.destination ? `${t.title}, ${t.destination}` : t.title, children: kidNames(t.childIds) });
        continue;
      }
      const names = t.travellerIds.map(adultName).filter((n): n is string => !!n);
      if (!names.length) continue;
      const back = instantToLocalDate(t.end - 1, tz) === date;
      items.push({ key: `t:${t.id}:${date}`, kind: "away", time: null, endTime: null, title: back ? `${names.join(" and ")} home at ${hm(t.end)}` : `${names.join(" and ")} away`, children: [] });
    }
    items.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
    out.push({ date, marker: view.markers[date] ?? null, weather: view.weather[date] ?? null, items });
  }
  return out;
}

/**
 * A child picks one of the ideas on their own screen. It becomes a wish the
 * adults see (and a gentle push), unless one is already waiting. Only one of the
 * ideas they were offered, and only when it is their turn.
 */
export async function makeWish(db: Db, token: string, activityKey: string, now = new Date()): Promise<DisplayView | null> {
  const view = await displayView(db, token, now);
  if (!view?.child) return null;
  const choice = view.choices.find((c) => c.key === activityKey);
  if (!choice) return view;
  const found = await loadDisplayLink(db, token);
  if (!found) return null;
  const householdId = found.household.id;
  const child = view.child;
  await db.transaction(async (tx) => {
    await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
    const [open] = await tx.select({ id: childWishes.id }).from(childWishes).where(and(eq(childWishes.childId, child.id), isNull(childWishes.handledAt)));
    if (open) return;
    const [wish] = await tx.insert(childWishes).values({ householdId, childId: child.id, activityKey: choice.key, title: choice.title }).returning({ id: childWishes.id });
    const adults = await tx.select({ id: memberships.accountId }).from(memberships).where(and(eq(memberships.householdId, householdId), isNull(memberships.endsAt)));
    for (const a of adults) {
      await tx
        .insert(outbox)
        .values({
          householdId,
          eventType: "notify",
          dedupeKey: `notify:child.wish:${wish.id}:${a.id}`,
          payload: { recipientId: a.id, kind: "child.wish", text: `${child.name} picked ${choice.title} for the family.`, sourceType: "wish", sourceId: wish.id, sourceVersion: 1, householdId },
        })
        .onConflictDoNothing({ target: outbox.dedupeKey });
    }
  });
  return displayView(db, token, now);
}

/** The household's live screen links, for Settings. */
export async function screenLinksFor(db: Db, householdId: string) {
  const rows = await db
    .select()
    .from(displayLinks)
    .where(and(eq(displayLinks.householdId, householdId), isNull(displayLinks.revokedAt)))
    .orderBy(asc(displayLinks.createdAt));
  return rows.map((r) => ({ id: r.id, childId: r.childId, createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt?.toISOString() ?? null }));
}
