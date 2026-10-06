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
  limit?: number;
}

export interface SuggestedTime {
  start: number;
  end: number;
  date: string;
  startTime: string;
  endTime: string;
  /** Whether the children are looked after, need arranging, or come along. */
  care: "with_family" | "partner_free" | "needs_care" | "no_children";
  score: number;
}

const hours = (ms: number, tz: string) => {
  const t = instantToLocal(ms, tz);
  return { h: t.hour + t.minute / 60, weekend: t.dayOfWeek >= 6 };
};

/** How well a start time suits this kind of time (higher is better). */
export function suitability(kind: MomentKind, h: number, weekend: boolean): number {
  if (kind === "us") {
    if (h >= 18.5 && h <= 20) return 10;
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

  for (let d = 0; d < input.days; d++) {
    const date = addDays(today, d);
    const dayWindow = {
      start: Math.max(firstStart, localToInstantCompatible(`${date}T${input.dayStart ?? "07:00"}`, tz)),
      end: localToInstantCompatible(`${date}T${input.dayEnd ?? "22:30"}`, tz),
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
        options.push({ start: s, end: s + duration, date, startTime: clock(s, tz), endTime: clock(s + duration, tz), care: "no_children", score: suitability(kind, h, weekend) });
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
    else {
      const carerFree = input.carerIds.some((id) => commonFreeWindows([id], { start: c.start, end: c.end }, input.busy, input.durationMinutes).length > 0);
      c.care = carerFree ? "partner_free" : "needs_care";
    }
  }
  // Easiest to make happen first: best fit, then no extra childcare, then soonest.
  const careRank = { no_children: 0, with_family: 0, partner_free: 0, needs_care: 1 };
  return candidates
    .sort((a, b) => b.score - a.score || careRank[a.care] - careRank[b.care] || a.start - b.start)
    .slice(0, input.limit ?? 6)
    .sort((a, b) => a.start - b.start);
}
