import { instantToLocal } from "./time";

/**
 * Wording that is safe on a lock screen. Phones get read over shoulders and
 * picked up by children, so anything about time for the two of you names
 * the person and the time, never the plan ("Friday evening: plans with Sam").
 */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function partOfDay(ms: number, timeZone: string): "morning" | "afternoon" | "evening" {
  const h = instantToLocal(ms, timeZone).hour;
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

/** "tonight", "tomorrow evening", "Friday evening", "14 October". */
export function whenPhrase(ms: number, nowMs: number, timeZone: string): string {
  const at = instantToLocal(ms, timeZone);
  const now = instantToLocal(nowMs, timeZone);
  const days = now.toPlainDate().until(at.toPlainDate()).days;
  const part = partOfDay(ms, timeZone);
  if (days === 0) return part === "evening" ? "tonight" : `this ${part}`;
  if (days === 1) return `tomorrow ${part}`;
  if (days > 1 && days < 7) return `${DAYS[at.dayOfWeek - 1]} ${part}`;
  return `${at.day} ${MONTHS[at.month - 1]}`;
}

/** The lock-screen name for time for the two of you. */
export function plansWith(name: string | null | undefined): string {
  return `Plans with ${name || "your partner"}`;
}
