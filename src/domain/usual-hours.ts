import type { Busy } from "./availability";
import type { Interval } from "./intervals";
import { addDays, localToInstantCompatible } from "./time";

/**
 * The hours a household is usually not free, assumed until it says otherwise
 * (review: "suggestions ignore school by default"). A suggestion is never
 * offered inside them: no cinema trip at 11:00 on a school day, no Me time
 * at 14:00 on a working Tuesday. Nothing here is stored or shown; it only
 * removes impossible times from what More suggests.
 */

/** A UK school day, drop-off to pick-up. */
export const SCHOOL_DAY = { start: "08:30", end: "15:30" } as const;
/** A usual working day, for an adult who hasn't told More their own pattern. */
export const WORK_DAY = { start: "09:00", end: "17:30" } as const;
/** Children of school age; younger ones may be at home or at nursery, so nothing is assumed. */
export const SCHOOL_AGE: readonly string[] = ["5-7", "8-11", "12-15"];

export interface SchoolBreak {
  startDate: string;
  endDateExclusive: string;
  childIds: readonly string[];
}

export interface UsualHoursInput {
  timeZone: string;
  /** First local date to cover, YYYY-MM-DD. */
  from: string;
  days: number;
  /** Adults with no working pattern of their own in More: they get the usual working day. */
  workers: readonly string[];
  children: readonly { id: string; ageBand: string }[];
  /** School holidays and INSET days: the named children are off school. */
  breaks: readonly SchoolBreak[];
  /** Bank holidays: no school and no work. */
  dayOff?: (date: string) => boolean;
}

export interface UsualHours {
  /** Busy time for the adults' working day, for free-time searches only. */
  work: Busy[];
  /** Each school-age child's school day. */
  school: { childId: string; start: number; end: number }[];
}

const weekday = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
};

export function usualHours(input: UsualHoursInput): UsualHours {
  const tz = input.timeZone;
  const pupils = input.children.filter((c) => SCHOOL_AGE.includes(c.ageBand));
  const work: Busy[] = [];
  const school: UsualHours["school"] = [];
  for (let i = 0; i < input.days; i++) {
    const date = addDays(input.from, i);
    if (!weekday(date) || input.dayOff?.(date)) continue;
    const span = (h: { start: string; end: string }) => ({ start: localToInstantCompatible(`${date}T${h.start}`, tz), end: localToInstantCompatible(`${date}T${h.end}`, tz) });
    for (const personId of input.workers) {
      work.push({ personId, ...span(WORK_DAY), sourceType: "event", sourceId: `usual-work:${date}`, ownerId: personId, visibility: "busy_only", title: "Usual working hours" });
    }
    for (const c of pupils) {
      const off = input.breaks.some((b) => b.startDate <= date && date < b.endDateExclusive && b.childIds.includes(c.id));
      if (!off) school.push({ childId: c.id, ...span(SCHOOL_DAY) });
    }
  }
  return { work, school };
}

/**
 * Whether every child is at school for the whole of a time, so nobody needs
 * to look after them then. A child too young for school is never assumed to
 * be anywhere.
 */
export function allAtSchool(children: readonly { id: string }[], school: UsualHours["school"], span: Interval): boolean {
  if (!children.length) return false;
  return children.every((c) => school.some((s) => s.childId === c.id && s.start <= span.start && span.end <= s.end));
}
