import { Temporal } from "@js-temporal/polyfill";

/**
 * Rituals (plans that repeat). Weekly and fortnightly dates keep the first
 * date's weekday; monthly keeps its "nth weekday" (the 2nd Saturday), and a
 * 5th weekday becomes the month's last one so no month is skipped.
 */

export type Cadence = "weekly" | "fortnightly" | "monthly";

export interface RitualRule {
  cadence: Cadence;
  startsOn: string;
}

function nthWeekday(year: number, month: number, weekday: number, n: number): Temporal.PlainDate {
  const first = Temporal.PlainDate.from({ year, month, day: 1 });
  const offset = (weekday - first.dayOfWeek + 7) % 7;
  let d = first.add({ days: offset + 7 * (n - 1) });
  if (d.month !== month) d = d.subtract({ days: 7 });
  return d;
}

/** Ritual dates from `from` to `to` inclusive (local dates). */
export function ritualDates(rule: RitualRule, from: string, to: string): string[] {
  const start = Temporal.PlainDate.from(rule.startsOn);
  const lo = Temporal.PlainDate.compare(Temporal.PlainDate.from(from), start) > 0 ? Temporal.PlainDate.from(from) : start;
  const hi = Temporal.PlainDate.from(to);
  const out: string[] = [];
  if (rule.cadence === "monthly") {
    const n = Math.min(Math.ceil(start.day / 7), 5);
    let cursor = Temporal.PlainYearMonth.from({ year: lo.year, month: lo.month });
    for (let i = 0; i < 24; i++) {
      const d = nthWeekday(cursor.year, cursor.month, start.dayOfWeek, n);
      if (Temporal.PlainDate.compare(d, hi) > 0) break;
      if (Temporal.PlainDate.compare(d, lo) >= 0 && Temporal.PlainDate.compare(d, start) >= 0) out.push(d.toString());
      cursor = cursor.add({ months: 1 });
    }
    return out;
  }
  const step = rule.cadence === "weekly" ? 7 : 14;
  const gap = lo.since(start).days;
  let d = start.add({ days: Math.ceil(gap / step) * step });
  while (Temporal.PlainDate.compare(d, hi) <= 0) {
    out.push(d.toString());
    d = d.add({ days: step });
  }
  return out;
}

export function cadenceLabel(cadence: Cadence, startsOn: string): string {
  const d = Temporal.PlainDate.from(startsOn);
  const day = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][d.dayOfWeek - 1];
  if (cadence === "weekly") return `Every ${day}`;
  if (cadence === "fortnightly") return `Every other ${day}`;
  const n = Math.ceil(d.day / 7);
  return `The ${n >= 5 ? "last" : ["first", "second", "third", "fourth"][n - 1]} ${day} of each month`;
}
