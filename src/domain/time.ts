import { Temporal } from "@js-temporal/polyfill";
import { DomainError } from "./errors";
import type { Interval } from "./intervals";

/**
 * Temporal rules (spec 11.2): timed occurrences are stored as UTC instants
 * plus an IANA timezone; all-day items use local dates with an exclusive end.
 * The server's own timezone never decides a household's week.
 */

export const DEFAULT_TIMEZONE = "Europe/London";

export type Disambiguation = "earlier" | "later";

export function isValidTimeZone(tz: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(tz);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a local wall-clock time to an instant. A time that does not exist
 * (spring-forward gap) is rejected; a time that occurs twice (autumn
 * fall-back) requires an explicit choice of the earlier or later offset.
 */
export function localToInstant(
  localDateTime: string,
  timeZone: string,
  choice?: Disambiguation,
): number {
  const local = Temporal.PlainDateTime.from(localDateTime);
  const earlier = local.toZonedDateTime(timeZone, { disambiguation: "earlier" });
  const later = local.toZonedDateTime(timeZone, { disambiguation: "later" });
  const earlierMatches = Temporal.PlainDateTime.compare(earlier.toPlainDateTime(), local) === 0;
  const laterMatches = Temporal.PlainDateTime.compare(later.toPlainDateTime(), local) === 0;

  if (!earlierMatches && !laterMatches) {
    throw new DomainError("DST_GAP", "That time does not exist because the clocks change. Choose another time.", {
      localDateTime,
      timeZone,
      suggestion: later.toPlainDateTime().toString({ smallestUnit: "minute" }),
    });
  }
  if (earlier.epochMilliseconds !== later.epochMilliseconds) {
    if (!choice) {
      throw new DomainError("DST_AMBIGUOUS", "That time happens twice because the clocks go back. Choose which one.", {
        localDateTime,
        timeZone,
      });
    }
    return (choice === "earlier" ? earlier : later).epochMilliseconds;
  }
  return earlier.epochMilliseconds;
}

/** Lenient conversion for generated occurrences: gaps shift forward (RFC 5545). */
export function localToInstantCompatible(localDateTime: string, timeZone: string): number {
  return Temporal.PlainDateTime.from(localDateTime)
    .toZonedDateTime(timeZone, { disambiguation: "compatible" }).epochMilliseconds;
}

export function instantToLocal(epochMs: number, timeZone: string): Temporal.PlainDateTime {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone).toPlainDateTime();
}

export function instantToLocalDate(epochMs: number, timeZone: string): string {
  return instantToLocal(epochMs, timeZone).toPlainDate().toString();
}

/** Start of a local date in a timezone (handles days that start at 01:00). */
export function startOfLocalDate(date: string, timeZone: string): number {
  return Temporal.PlainDate.from(date).toZonedDateTime({ timeZone }).epochMilliseconds;
}

/** All-day span: local dates, exclusive end date. */
export function allDayInterval(startDate: string, endDateExclusive: string, timeZone: string): Interval {
  const start = startOfLocalDate(startDate, timeZone);
  const end = startOfLocalDate(endDateExclusive, timeZone);
  if (!(end > start)) throw new DomainError("VALIDATION", "The end date must be after the start date.");
  return { start, end };
}

/** The Monday (ISO week start) of the week containing a local date. */
export function weekKeyFor(date: string): string {
  const d = Temporal.PlainDate.from(date);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString();
}

export function currentWeekKey(timeZone: string, nowMs = Date.now()): string {
  return weekKeyFor(instantToLocalDate(nowMs, timeZone));
}

export function isWeekKey(value: string): boolean {
  try {
    return weekKeyFor(value) === value;
  } catch {
    return false;
  }
}

/** The household week as an instant interval, Monday 00:00 to next Monday 00:00 local. */
export function weekInterval(weekKey: string, timeZone: string): Interval {
  if (!isWeekKey(weekKey)) throw new DomainError("VALIDATION", "A week must start on a Monday.");
  const next = Temporal.PlainDate.from(weekKey).add({ days: 7 }).toString();
  return { start: startOfLocalDate(weekKey, timeZone), end: startOfLocalDate(next, timeZone) };
}

export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

export function daysOfWeek(weekKey: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekKey, i));
}
