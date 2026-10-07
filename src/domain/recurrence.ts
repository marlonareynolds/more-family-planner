import { Temporal } from "@js-temporal/polyfill";
import { DomainError } from "./errors";
import { overlaps, type Interval } from "./intervals";
import { allDayInterval, localToInstantCompatible } from "./time";

/**
 * Recurring series with stable occurrence identity (spec 8.4, 11.2).
 * An occurrence is identified by its ORIGINAL local start ("recurrence id"),
 * which never changes even if that occurrence is moved to another week.
 */

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RecurrenceRule {
  freq: Frequency;
  interval?: number;
  /** WEEKLY only: which weekdays. Defaults to the start's weekday. */
  byDay?: Weekday[];
  /** Total occurrences counted from the series start. */
  count?: number;
  /** Exclusive local datetime cut-off, used when a series is split. */
  endsBefore?: string;
}

export interface SeriesDefinition {
  /** Local wall-clock start, e.g. 2026-10-05T08:30 (all-day: T00:00). */
  localStart: string;
  timeZone: string;
  allDay: boolean;
  /** Timed: minutes. All-day: whole days × 1440. */
  durationMinutes: number;
  rule: RecurrenceRule;
}

export type SeriesException =
  | { recurrenceId: string; kind: "cancelled" }
  | { recurrenceId: string; kind: "moved"; start: number; end: number };

export interface Occurrence {
  recurrenceId: string;
  start: number;
  end: number;
  moved: boolean;
}

/** Guardrail against unbounded rules (spec 11.2). */
const MAX_CANDIDATES = 20_000;

export function validateRule(def: SeriesDefinition): void {
  const { rule } = def;
  const n = rule.interval ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 366) throw new DomainError("VALIDATION", "Repeat interval must be 1 to 366.");
  if (rule.count !== undefined && (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > 5000)) {
    throw new DomainError("VALIDATION", "Repeat count must be 1 to 5000.");
  }
  if (rule.byDay && (rule.freq !== "WEEKLY" || rule.byDay.length === 0)) {
    throw new DomainError("VALIDATION", "Weekdays can only be chosen for weekly repeats.");
  }
  if (def.durationMinutes <= 0) throw new DomainError("VALIDATION", "An event needs a positive duration.");
}

function weekdayCode(d: Temporal.PlainDate): Weekday {
  return WEEKDAYS[d.dayOfWeek - 1];
}

/** Lazily generate local candidate starts in chronological order. */
function* candidates(def: SeriesDefinition): Generator<Temporal.PlainDateTime> {
  const start = Temporal.PlainDateTime.from(def.localStart);
  const step = def.rule.interval ?? 1;
  const time = start.toPlainTime();

  if (def.rule.freq === "DAILY") {
    for (let i = 0; ; i++) yield start.add({ days: i * step });
  }

  if (def.rule.freq === "WEEKLY") {
    const days = new Set(def.rule.byDay ?? [weekdayCode(start.toPlainDate())]);
    const weekStart = start.toPlainDate().subtract({ days: start.dayOfWeek - 1 });
    for (let w = 0; ; w++) {
      const monday = weekStart.add({ weeks: w * step });
      for (let d = 0; d < 7; d++) {
        const day = monday.add({ days: d });
        if (!days.has(weekdayCode(day))) continue;
        const dt = day.toPlainDateTime(time);
        if (Temporal.PlainDateTime.compare(dt, start) < 0) continue;
        yield dt;
      }
    }
  }

  // MONTHLY / YEARLY: dates that do not exist (31 April, 29 February in a
  // common year) are skipped, never clamped (RFC 5545).
  for (let i = 0; ; i++) {
    const months = def.rule.freq === "MONTHLY" ? i * step : i * step * 12;
    const ym = Temporal.PlainYearMonth.from({ year: start.year, month: start.month }).add({ months });
    if (start.day > ym.daysInMonth) {
      yield null as unknown as Temporal.PlainDateTime; // placeholder: skipped slot
      continue;
    }
    yield Temporal.PlainDateTime.from({ year: ym.year, month: ym.month, day: start.day, hour: start.hour, minute: start.minute });
  }
}

function occurrenceInterval(def: SeriesDefinition, local: Temporal.PlainDateTime): Interval {
  if (def.allDay) {
    const date = local.toPlainDate();
    const days = Math.max(1, Math.round(def.durationMinutes / 1440));
    return allDayInterval(date.toString(), date.add({ days }).toString(), def.timeZone);
  }
  const start = localToInstantCompatible(local.toString(), def.timeZone);
  // Duration is wall-clock elapsed time, so a 2h event across a DST change stays 2h.
  return { start, end: start + def.durationMinutes * 60_000 };
}

export function recurrenceIdOf(local: Temporal.PlainDateTime): string {
  return local.toString({ smallestUnit: "minute" });
}

/**
 * Expand occurrences that overlap `horizon`. Moved exceptions appear where
 * they now sit, even if their original slot lies outside the horizon.
 */
export function expand(
  def: SeriesDefinition,
  horizon: Interval,
  exceptions: readonly SeriesException[] = [],
): Occurrence[] {
  validateRule(def);
  const byId = new Map(exceptions.map((e) => [e.recurrenceId, e]));
  const latestMovedOriginal = exceptions
    .filter((e) => e.kind === "moved")
    .map((e) => e.recurrenceId)
    .sort()
    .at(-1);
  const endsBefore = def.rule.endsBefore ? Temporal.PlainDateTime.from(def.rule.endsBefore) : null;
  // Candidates this far before the horizon can't reach it (events last at
  // most 14 days), so skip the time-zone work for them unless they were moved.
  // This keeps a long-running series cheap to read (BR-18).
  const tooEarly = Temporal.Instant.fromEpochMilliseconds(horizon.start - 16 * 86_400_000).toZonedDateTimeISO(def.timeZone).toPlainDateTime();

  const out: Occurrence[] = [];
  let produced = 0;
  let guard = 0;
  for (const local of candidates(def)) {
    if (++guard > MAX_CANDIDATES) break;
    if (local === null) continue;
    if (endsBefore && Temporal.PlainDateTime.compare(local, endsBefore) >= 0) break;
    if (def.rule.count !== undefined && produced >= def.rule.count) break;
    produced++;

    const id = recurrenceIdOf(local);
    if (Temporal.PlainDateTime.compare(local, tooEarly) < 0 && byId.get(id)?.kind !== "moved") continue;
    const natural = occurrenceInterval(def, local);
    const beyondHorizon = natural.start >= horizon.end;
    if (beyondHorizon && (!latestMovedOriginal || id > latestMovedOriginal)) break;

    const ex = byId.get(id);
    if (ex?.kind === "cancelled") continue;
    const occ: Occurrence = ex?.kind === "moved"
      ? { recurrenceId: id, start: ex.start, end: ex.end, moved: true }
      : { recurrenceId: id, start: natural.start, end: natural.end, moved: false };
    if (overlaps(occ, horizon)) out.push(occ);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Is `recurrenceId` a genuine occurrence of this series (ignoring exceptions)? */
export function isOccurrence(def: SeriesDefinition, recurrenceId: string): boolean {
  const target = Temporal.PlainDateTime.from(recurrenceId);
  const endsBefore = def.rule.endsBefore ? Temporal.PlainDateTime.from(def.rule.endsBefore) : null;
  let produced = 0;
  let guard = 0;
  for (const local of candidates(def)) {
    if (++guard > MAX_CANDIDATES) return false;
    if (local === null) continue;
    if (endsBefore && Temporal.PlainDateTime.compare(local, endsBefore) >= 0) return false;
    if (def.rule.count !== undefined && produced >= def.rule.count) return false;
    produced++;
    const cmp = Temporal.PlainDateTime.compare(local, target);
    if (cmp === 0) return true;
    if (cmp > 0) return false;
  }
  return false;
}

/**
 * "This and future": end the original series before `recurrenceId` and
 * return the definition for a new series starting there. Past occurrences,
 * and anything attached to them, stay with the original series.
 */
export function splitSeries(
  def: SeriesDefinition,
  recurrenceId: string,
  changes: Partial<Pick<SeriesDefinition, "localStart" | "durationMinutes" | "rule">> = {},
): { before: SeriesDefinition; after: SeriesDefinition } {
  if (!isOccurrence(def, recurrenceId)) throw new DomainError("VALIDATION", "That date is not part of this series.");
  let consumed = 0;
  if (def.rule.count !== undefined) {
    const target = Temporal.PlainDateTime.from(recurrenceId);
    for (const local of candidates(def)) {
      if (local === null) continue;
      if (Temporal.PlainDateTime.compare(local, target) >= 0) break;
      consumed++;
    }
  }
  const before: SeriesDefinition = {
    ...def,
    rule: { ...def.rule, endsBefore: recurrenceId, count: def.rule.count },
  };
  const remaining = def.rule.count !== undefined ? def.rule.count - consumed : undefined;
  const afterRule: RecurrenceRule = { ...def.rule, count: remaining, ...changes.rule };
  if (def.rule.byDay && !changes.rule?.byDay && changes.localStart) {
    afterRule.byDay = def.rule.byDay;
  }
  const after: SeriesDefinition = {
    ...def,
    localStart: changes.localStart ?? recurrenceId,
    durationMinutes: changes.durationMinutes ?? def.durationMinutes,
    rule: afterRule,
  };
  return { before, after };
}

/** RFC 5545 RRULE text, for ICS export and interchange. */
export function toRRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  return parts.join(";");
}
