import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { PlanWeekFlow } from "@/components/plan-week";
import { planningWeekKey } from "@/domain/reach";
import { addDays, startOfLocalDate } from "@/domain/time";
import { requireHousehold } from "@/server/page-data";
import { freeTimesFor } from "@/server/queries/free-time";
import { picksFor, type WeekPicks } from "@/server/queries/picks";
import { getWeek } from "@/server/queries/week";

export const metadata = { title: "Plan the week" };

/**
 * The Sunday ten minutes (spec 3.3): one guided pass over the coming week
 * that ends with one message to the other adult. It deals with the noise:
 * time for the two of you is never on this list (facilitate, never force),
 * only the plain fact of which evenings are free for you both.
 */
export default async function PlanPage() {
  const { actor, db, household } = await requireHousehold();
  const now = new Date();
  const tz = household.timeZone;
  const weekKey = planningWeekKey(now.getTime(), tz);
  const week = await getWeek(db, actor, weekKey, now);
  const weekStart = startOfLocalDate(weekKey, tz);
  const weekEnd = startOfLocalDate(addDays(weekKey, 7), tz);
  const from = new Date(Math.max(now.getTime(), weekStart));
  const days = Math.max(1, Math.ceil((weekEnd - from.getTime()) / 86_400_000));
  const kinds: ("me" | "family")[] = ["me", ...(week.children.length ? (["family"] as const) : [])];
  const picks: Partial<Record<"me" | "family", WeekPicks>> = {};
  for (const k of kinds) {
    const res = await picksFor(db, actor, k, now, { from, days, count: 3 });
    // Only times inside the week being planned.
    picks[k] = { ...res, picks: res.picks.filter((p) => !p.slot || p.slot.start < weekEnd) };
  }
  const evenings = week.adults.length > 1 ? (await freeTimesFor(db, actor, "us", 150, from, days, ["18:30", "20:00"])).slots.filter((s) => s.start < weekEnd) : [];
  const freeEvenings = [...new Set(evenings.map((s) => s.date))].sort();
  return (
    <AppProvider value={infoFrom(week)}>
      <PlanWeekFlow week={week} picks={picks} freeEvenings={freeEvenings} />
    </AppProvider>
  );
}
