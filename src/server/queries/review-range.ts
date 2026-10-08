import { planningWeekKey } from "@/domain/reach";
import { addDays, instantToLocalDate } from "@/domain/time";

/**
 * The span the weekly review covers: from today to the end of the week being
 * planned. Sunday planning and Today both use it, so they count the same
 * decisions. From Friday the planned week is next week, so the rest of this
 * week stays in view rather than falling between the two.
 */
export function reviewRange(now: Date, timeZone: string): { from: string; to: string; days: number; lastDay: string } {
  const from = instantToLocalDate(now.getTime(), timeZone);
  const to = addDays(planningWeekKey(now.getTime(), timeZone), 7);
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  return { from, to, days, lastDay: addDays(to, -1) };
}
