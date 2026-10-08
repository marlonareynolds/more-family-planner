import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dinners, jobs, meals, shoppingItems } from "@/db/schema";
import { dinnerLabel, hardEveningReasons, joinReasons, type DinnerChoice, type DinnerRole } from "@/domain/meals";
import { addDays, instantToLocal, instantToLocalDate } from "@/domain/time";
import type { Actor } from "../auth";
import { householdFor, type WeekView } from "./week";

export interface MealView {
  id: string;
  name: string;
  ingredients: string[];
  quick: boolean;
  version: number;
}

export interface DinnerJobView {
  jobId: string;
  role: DinnerRole;
  ownerId: string | null;
  proposedOwnerId: string | null;
  version: number;
}

export interface DinnerView {
  id: string;
  date: string;
  choice: DinnerChoice;
  mealId: string | null;
  label: string;
  note: string;
  version: number;
  /** Who cooks and who clears up: jobs, so a request stays a request until it's answered. */
  jobs: DinnerJobView[];
}

export interface ShoppingLine {
  itemKey: string;
  name: string;
  /** The dinners it's for ("Tue", "Thu"), and whether someone also added it by hand. */
  forDates: string[];
  byHand: boolean;
  got: boolean;
}

export interface MealsView {
  today: string;
  meals: MealView[];
  dinners: DinnerView[];
  shopping: ShoppingLine[];
}

/**
 * Dinners from `from` for `days` days, the saved meals, and the shopping
 * list. Everything here is shared household planning: no private plan,
 * budget or note feeds it.
 */
export async function mealsFor(db: Db, actor: Actor, from: string, days: number, now = new Date()): Promise<MealsView> {
  const household = await householdFor(db, actor);
  if (!household) return { today: "", meals: [], dinners: [], shopping: [] };
  const today = instantToLocalDate(now.getTime(), household.timeZone);
  const mealRows = await db.select().from(meals).where(and(eq(meals.householdId, household.id), isNull(meals.archivedAt))).orderBy(asc(meals.name));
  const dinnerRows = await db
    .select()
    .from(dinners)
    .where(and(eq(dinners.householdId, household.id), gte(dinners.date, from), lte(dinners.date, addDays(from, days - 1))))
    .orderBy(dinners.date);
  // A dinner's meal may since have been removed from the saved list; it keeps its name.
  const named = new Map(mealRows.map((m) => [m.id, m.name]));
  const missing = dinnerRows.map((d) => d.mealId).filter((id): id is string => !!id && !named.has(id));
  if (missing.length) for (const m of await db.select({ id: meals.id, name: meals.name }).from(meals).where(inArray(meals.id, missing))) named.set(m.id, m.name);
  const jobRows = dinnerRows.length
    ? await db.select().from(jobs).where(and(eq(jobs.forType, "dinner"), inArray(jobs.forId, dinnerRows.map((d) => d.id)), isNull(jobs.archivedAt)))
    : [];

  // The list: hand-added lines, and the ingredients of dinners from today on.
  const items = await db
    .select({ item: shoppingItems, date: dinners.date })
    .from(shoppingItems)
    .leftJoin(dinners, eq(dinners.id, shoppingItems.dinnerId))
    .where(and(eq(shoppingItems.householdId, household.id), isNull(shoppingItems.clearedAt), or(isNull(shoppingItems.dinnerId), gte(dinners.date, today))))
    .orderBy(shoppingItems.createdAt);
  const lines = new Map<string, ShoppingLine>();
  for (const { item, date } of items) {
    const line = lines.get(item.itemKey) ?? { itemKey: item.itemKey, name: item.name, forDates: [], byHand: false, got: true };
    if (date) line.forDates.push(date);
    else line.byHand = true;
    // One line is ticked only when every row behind it is.
    line.got = line.got && !!item.gotAt;
    lines.set(item.itemKey, line);
  }
  for (const l of lines.values()) l.forDates.sort();

  return {
    today,
    meals: mealRows.map((m) => ({ id: m.id, name: m.name, ingredients: m.ingredients, quick: m.quick, version: m.version })),
    dinners: dinnerRows.map((d) => ({
      id: d.id,
      date: d.date,
      choice: d.choice,
      mealId: d.mealId,
      label: dinnerLabel(d.choice, d.mealId ? (named.get(d.mealId) ?? null) : null, d.note),
      note: d.note,
      version: d.version,
      jobs: jobRows
        .filter((j) => j.forId === d.id && j.role)
        .map((j) => ({ jobId: j.id, role: j.role!, ownerId: j.ownerId, proposedOwnerId: j.proposedOwnerId, version: j.version })),
    })),
    shopping: [...lines.values()].sort((a, b) => Number(a.got) - Number(b.got)),
  };
}

/**
 * An offer of an easy dinner on evenings the diary says will be hard ("a
 * late finish and football"), only where dinner isn't already easy and the
 * household has a quick meal to offer. Built from the viewer's own
 * projection, so a partner's busy time is "a late finish", never its title.
 */
export function easyDinnerOffers(week: Pick<WeekView, "events" | "household">, meals: MealsView): Record<string, string> {
  const tz = week.household.timeZone;
  if (!meals.meals.some((m) => m.quick)) return {};
  const clock = (ms: number) => instantToLocal(ms, tz).toPlainTime().toString().slice(0, 5);
  const byDate = new Map<string, Parameters<typeof hardEveningReasons>[0][number][]>();
  for (const e of week.events) {
    if (e.allDay) continue;
    const date = instantToLocalDate(e.start, tz);
    if (instantToLocalDate(e.end - 1, tz) !== date) continue;
    const item = { startTime: clock(e.start), endTime: clock(e.end), allDay: false, adults: e.adultIds.length, children: e.childIds.length, title: e.detailsHidden || e.visibility !== "shared" ? null : e.title };
    byDate.set(date, [...(byDate.get(date) ?? []), item]);
  }
  const out: Record<string, string> = {};
  for (const [date, items] of byDate) {
    if (date < meals.today) continue;
    const d = meals.dinners.find((x) => x.date === date);
    const easy = d && (d.choice === "fallback" || d.choice === "leftovers" || d.choice === "elsewhere" || (d.choice === "meal" && meals.meals.find((m) => m.id === d.mealId)?.quick));
    if (easy) continue;
    const reasons = hardEveningReasons(items);
    if (reasons.length) out[date] = joinReasons(reasons);
  }
  return out;
}
