import { commonFreeWindows, type Busy } from "./availability";
import { subtract, union, type Interval } from "./intervals";
import { addDays, instantToLocal, instantToLocalDate, localToInstantCompatible } from "./time";

/**
 * "When could we?" (spec 11, steps 1–7): find times when everyone a plan
 * needs is free, inside waking hours, ranked by what usually suits that
 * kind of time. A suggestion is not a booking: it only pre-fills a draft.
 */

export type MomentKind = "me" | "us" | "family";

export interface FreeTimeInput {
  kind: MomentKind;
  now: number;
  timeZone: string;
  days: number;
  durationMinutes: number;
  /** Adults who take part. */
  participantIds: string[];
  /** Adults who could look after the children meanwhile (for Me time, the partner). */
  carerIds: string[];
  hasChildren: boolean;
  busy: readonly Busy[];
  /** Children's own commitments, which block family time. */
  childBusy: readonly Interval[];
  dayStart?: string;
  dayEnd?: string;
  /** When the household says family time usually ends; 19:30 if they haven't said. */
  familyDayEnd?: string;
  /** Only start between these local times ("HH:MM"), for ideas tied to a time of day. */
  startBetween?: readonly [string, string];
  /** Days most people are off work (bank holidays): treated like a weekend for long outings. */
  dayOff?: (date: string) => boolean;
  /** Care the household has already arranged for the children over a time, if any. */
  arrangedCare?: (start: number, end: number) => ArrangedCare | null;
  limit?: number;
}

/**
 * What is already in place for the children over a time: every child
 * covered by confirmed care, covered once pending asks say yes, or only
 * partly covered.
 */
export type ArrangedCare = "covered" | "pending" | "partly";

export interface SuggestedTime {
  start: number;
  end: number;
  date: string;
  startTime: string;
  endTime: string;
  /**
   * Whether the children come along, are already looked after (confirmed,
   * or asked and waiting), need arranging, or whether a free partner could
   * look after them (a possibility, not their agreement).
   */
  care: "with_family" | "arranged" | "pending" | "partly_arranged" | "partner_free" | "needs_care" | "no_children";
  score: number;
}

const hours = (ms: number, tz: string) => {
  const t = instantToLocal(ms, tz);
  return { h: t.hour + t.minute / 60, weekend: t.dayOfWeek >= 6 };
};

/** How well a start time suits this kind of time (higher is better). */
export function suitability(kind: MomentKind, h: number, weekend: boolean): number {
  if (kind === "us") {
    // After the children's bedtime, unless a sitter makes earlier work.
    if (h >= 19 && h <= 20) return 10;
    if (h >= 18 && h < 19) return 8;
    if (weekend && h >= 10 && h <= 15) return 8;
    if (!weekend && h >= 12 && h <= 13) return 5;
    return 2;
  }
  if (kind === "family") {
    if (weekend && h >= 9.5 && h <= 15) return 10;
    if (!weekend && h >= 16.5 && h <= 18) return 6;
    return 2;
  }
  if (weekend && h >= 8 && h <= 12) return 9;
  if (!weekend && ((h >= 6.5 && h <= 8.5) || (h >= 19 && h <= 21))) return 8;
  return 4;
}

/** Half a day or more: a day out, not something to squeeze into a weekday evening. */
export const LONG_OUTING_MINUTES = 240;
/** Family time ends around the children's bedtime, unless the household sets its own time. */
const FAMILY_DAY_END = "19:30";

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number, tz: string) => {
  const t = instantToLocal(ms, tz);
  return `${pad(t.hour)}:${pad(t.minute)}`;
};

export function suggestTimes(input: FreeTimeInput): SuggestedTime[] {
  const { timeZone: tz, kind } = input;
  const duration = input.durationMinutes * 60_000;
  const step = 30 * 60_000;
  const firstStart = Math.ceil((input.now + 15 * 60_000) / step) * step;
  const today = instantToLocalDate(input.now, tz);
  const candidates: SuggestedTime[] = [];

  const long = input.durationMinutes >= LONG_OUTING_MINUTES;
  for (let d = 0; d < input.days; d++) {
    const date = addDays(today, d);
    const offDay = hours(localToInstantCompatible(`${date}T12:00`, tz), tz).weekend || !!input.dayOff?.(date);
    // A seaside day belongs on a weekend or holiday, starting in the morning.
    if (long && !offDay) continue;
    const familyEnd = input.familyDayEnd ?? FAMILY_DAY_END;
    const dayEnd = kind === "family" && (input.dayEnd ?? "22:30") > familyEnd ? familyEnd : (input.dayEnd ?? "22:30");
    const dayWindow = {
      start: Math.max(firstStart, localToInstantCompatible(`${date}T${input.dayStart ?? "07:00"}`, tz)),
      end: localToInstantCompatible(`${date}T${dayEnd}`, tz),
    };
    if (dayWindow.end - dayWindow.start < duration) continue;
    let free = commonFreeWindows(input.participantIds, dayWindow, input.busy, input.durationMinutes);
    if (kind === "family" && input.childBusy.length) {
      free = free.flatMap((w) => subtract(w, union([...input.childBusy]))).filter((w) => w.end - w.start >= duration);
    }
    // The best-suited starts in each free window, kept apart so one long free
    // day offers a morning and an evening rather than two near-identical times.
    const perDay: SuggestedTime[] = [];
    for (const w of free) {
      const options: SuggestedTime[] = [];
      for (let s = Math.ceil(w.start / step) * step; s + duration <= w.end; s += step) {
        const { h, weekend } = hours(s, tz);
        if (long && (h < 8.5 || h > 11)) continue;
        const startTime = clock(s, tz);
        if (input.startBetween && (startTime < input.startBetween[0] || startTime > input.startBetween[1])) continue;
        options.push({ start: s, end: s + duration, date, startTime, endTime: clock(s + duration, tz), care: "no_children", score: suitability(kind, h, weekend || offDay) });
      }
      options.sort((a, b) => b.score - a.score || a.start - b.start);
      for (const o of options) {
        if (perDay.some((p) => Math.abs(p.start - o.start) < duration + 2 * 3_600_000)) continue;
        perDay.push(o);
        if (perDay.length >= 4) break;
      }
    }
    candidates.push(...perDay.sort((a, b) => b.score - a.score).slice(0, 2));
  }

  for (const c of candidates) {
    if (!input.hasChildren) c.care = "no_children";
    else if (kind === "family") c.care = "with_family";
    else c.care = careFor(input, c.start, c.end);
  }
  // Easiest to make happen first: best fit, then no extra childcare, then soonest.
  const careRank = { no_children: 0, with_family: 0, arranged: 0, pending: 0, partner_free: 0, partly_arranged: 1, needs_care: 1 };
  // Variety: at most two options share a start time, so an empty fortnight
  // offers a weekend daytime or a lunch, not six identical evenings.
  const seen = new Map<string, number>();
  const picked: SuggestedTime[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score || careRank[a.care] - careRank[b.care] || a.start - b.start)) {
    const key = `${c.startTime}|${hours(c.start, tz).weekend}`;
    if ((seen.get(key) ?? 0) >= 2) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    picked.push(c);
    if (picked.length >= (input.limit ?? 6)) break;
  }
  return picked.sort((a, b) => a.start - b.start);
}

/** Care for the children while the participants are busy with this time. */
function careFor(input: FreeTimeInput, start: number, end: number): SuggestedTime["care"] {
  const arranged = input.arrangedCare?.(start, end) ?? null;
  if (arranged === "covered") return "arranged";
  if (arranged === "pending") return "pending";
  const carerFree = input.carerIds.some((id) => commonFreeWindows([id], { start, end }, input.busy, (end - start) / 60_000).length > 0);
  if (carerFree) return "partner_free";
  return arranged === "partly" ? "partly_arranged" : "needs_care";
}

/**
 * Every day's first evening start, between `from` and `to` local time, when
 * all the participants are free for `minutes`. Unlike `suggestTimes` this is
 * a calendar fact, not a ranked shortlist: nothing is dropped for variety
 * (review R05). Care is filled in the same way as for suggestions.
 */
export function freeEvenings(
  input: Pick<FreeTimeInput, "now" | "timeZone" | "days" | "participantIds" | "carerIds" | "hasChildren" | "busy" | "arrangedCare"> & {
    minutes: number;
    from: string;
    to: string;
  },
): SuggestedTime[] {
  const tz = input.timeZone;
  const step = 30 * 60_000;
  const duration = input.minutes * 60_000;
  const earliest = Math.ceil((input.now + 15 * 60_000) / step) * step;
  const today = instantToLocalDate(input.now, tz);
  const out: SuggestedTime[] = [];
  for (let d = 0; d < input.days; d++) {
    const date = addDays(today, d);
    const first = Math.max(earliest, localToInstantCompatible(`${date}T${input.from}`, tz));
    const last = localToInstantCompatible(`${date}T${input.to}`, tz);
    if (first > last) continue;
    const windows = commonFreeWindows(input.participantIds, { start: first, end: last + duration }, input.busy, input.minutes);
    let start: number | null = null;
    for (const w of windows) {
      const s = Math.ceil(w.start / step) * step;
      if (s <= last && s + duration <= w.end) {
        start = s;
        break;
      }
    }
    if (start === null) continue;
    const slot: SuggestedTime = { start, end: start + duration, date, startTime: clock(start, tz), endTime: clock(start + duration, tz), care: "no_children", score: 0 };
    if (input.hasChildren) slot.care = careFor({ ...input, kind: "us", durationMinutes: input.minutes, childBusy: [] }, slot.start, slot.end);
    out.push(slot);
  }
  return out;
}
