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
