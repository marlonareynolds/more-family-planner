import { addDays, instantToLocal, instantToLocalDate, weekKeyFor } from "./time";

/**
 * When More may reach someone outside the app (spec 13.2): never during
 * their quiet hours, and several updates collapse into one message.
 */

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Whether a local clock time falls inside quiet hours, which may span midnight. */
export function inQuietHours(localHHMM: string, quietStart: string, quietEnd: string): boolean {
  const t = minutes(localHHMM);
  const s = minutes(quietStart);
  const e = minutes(quietEnd);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

export function localClock(epochMs: number, timeZone: string): string {
  const t = instantToLocal(epochMs, timeZone);
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

/**
 * The week the household is planning: from Friday onwards that's next week,
 * earlier in the week it's this one.
 */
export function planningWeekKey(epochMs: number, timeZone: string): string {
  const today = instantToLocalDate(epochMs, timeZone);
  const dow = instantToLocal(epochMs, timeZone).dayOfWeek;
  const thisWeek = weekKeyFor(today);
  return dow >= 5 ? addDays(thisWeek, 7) : thisWeek;
}

/** Sunday from 17:00 local time: when the "week ahead" email goes out. */
export function weekAheadDue(epochMs: number, timeZone: string): string | null {
  const t = instantToLocal(epochMs, timeZone);
  if (t.dayOfWeek !== 7 || t.hour < 17) return null;
  return addDays(weekKeyFor(instantToLocalDate(epochMs, timeZone)), 7);
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  /** Seconds the push service may hold it for an offline phone. */
  ttl?: number;
}

/** One message for whatever is waiting: lock-screen-safe texts only. */
export function bundle(items: { text: string; url: string }[]): PushMessage | null {
  if (!items.length) return null;
  if (items.length === 1) return { title: "More", body: items[0].text, url: items[0].url, tag: "more-updates" };
  return {
    title: "More",
    body: `${items.length} updates. ${items[items.length - 1].text}`,
    url: "/today",
    tag: "more-updates",
  };
}

/**
 * Push frequency policy (R03). Things from a person (an invitation, an
 * answer, a childcare ask, a child's pick) and leave-by notices go out on
 * the next run. Everything the app generates for itself (job and plan
 * reminders, weather swaps, clashes) waits for one of two daily bundles,
 * 07:30 and 18:00 local, so it reaches a phone at most twice a day unless
 * it can ride along with something a person sent. Quiet hours hold both.
 */
const TIMELY_PREFIXES = ["moment.invited", "moment.accepted", "moment.declined", "moment.changed", "moment.cancelled", "moment.swapped", "care.", "child.wish", "job.proposed", "job.answered", "job.covered", "job.taken", "task.assigned", "ritual.invited", "ritual.joined", "event.leave", "test"];

export function isTimely(kind: string): boolean {
  return TIMELY_PREFIXES.some((p) => kind === p || (p.endsWith(".") && kind.startsWith(p)));
}

export const BUNDLE_TIMES = ["07:30", "18:00"] as const;

/** The start of the bundle slot `epochMs` falls in, as an instant. */
export function bundleSlotStart(epochMs: number, timeZone: string, toInstant: (local: string) => number): number {
  const today = instantToLocalDate(epochMs, timeZone);
  const candidates = [addDays(today, -1), today].flatMap((d) => BUNDLE_TIMES.map((t) => toInstant(`${d}T${t}`)));
  return Math.max(...candidates.filter((c) => c <= epochMs));
}

/** How long a notice stays worth pushing, unless its source says otherwise. */
export const PUSH_TTL_MS = 16 * 3_600_000;
export const MAX_PUSH_ATTEMPTS = 5;

/** Minutes to wait before retry `attempt` (1-based): 1, 2, 4, 8… */
export function retryDelayMs(attempt: number): number {
  return Math.min(60, 2 ** (attempt - 1)) * 60_000;
}
