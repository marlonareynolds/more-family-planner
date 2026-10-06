import ICAL from "ical.js";
import { DomainError } from "./errors";
import type { Interval } from "./intervals";
import { allDayInterval, isValidTimeZone, localToInstantCompatible } from "./time";

/**
 * Read-only calendar import (spec 8.4, 8.11): turn an iCalendar feed into
 * concrete occurrences inside a window. Recurring series are expanded here,
 * with moved and cancelled occurrences applied, so More stores plain busy
 * windows and never needs to understand the provider's rules again.
 */

export interface ImportedOccurrence {
  /** Stable across syncs: the event UID plus the occurrence's original start. */
  externalId: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  /** Local start date in the household timezone, for all-day items. */
  startDate?: string;
  endDateExclusive?: string;
}

/** Windows zone names that Outlook feeds use instead of IANA ids. */
const WINDOWS_ZONES: Record<string, string> = {
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "E. Europe Standard Time": "Europe/Bucharest",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  UTC: "UTC",
};

function zoneFor(tzid: string | null | undefined, fallback: string): string {
  if (!tzid) return fallback;
  const clean = tzid.replace(/^\/[^/]+\/[^/]+\//, ""); // e.g. /mozilla.org/20050126_1/Europe/London
  if (isValidTimeZone(clean)) return clean;
  return WINDOWS_ZONES[clean] ?? fallback;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateOf = (t: ICAL.Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;

function instant(t: ICAL.Time, tzid: string | null, fallback: string): number {
  if (t.zone === ICAL.Timezone.utcTimezone || t.zone?.tzid === "UTC") {
    return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  }
  return localToInstantCompatible(`${dateOf(t)}T${pad(t.hour)}:${pad(t.minute)}`, zoneFor(tzid, fallback));
}

function tzidOf(event: ICAL.Event, prop: "dtstart" | "dtend"): string | null {
  const p = event.component.getFirstProperty(prop) ?? event.component.getFirstProperty("dtstart");
  const v = p?.getParameter("tzid");
  return typeof v === "string" ? v : null;
}

function skip(e: ICAL.Event): boolean {
  const status = String(e.component.getFirstPropertyValue("status") ?? "").toUpperCase();
  const transp = String(e.component.getFirstPropertyValue("transp") ?? "").toUpperCase();
  // Cancelled items and ones marked "free" don't occupy anyone.
  return status === "CANCELLED" || transp === "TRANSPARENT";
}

export const MAX_OCCURRENCES = 3000;

export function parseIcs(text: string, window: Interval, timeZone: string): ImportedOccurrence[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new DomainError("VALIDATION", "That link didn't return a calendar we can read.");
  }
  if (root.name !== "vcalendar") throw new DomainError("VALIDATION", "That link didn't return a calendar we can read.");

  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const v of root.getAllSubcomponents("vevent")) {
    const e = new ICAL.Event(v);
    if (!e.uid || !e.startDate) continue;
    if (e.isRecurrenceException()) exceptions.push(e);
    else masters.set(e.uid, e);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);

  const out: ImportedOccurrence[] = [];
  const push = (item: ICAL.Event, key: string, s: ICAL.Time, en: ICAL.Time | null) => {
    if (skip(item)) return;
    const title = (item.summary || "Busy").slice(0, 120);
    if (s.isDate) {
      const startDate = dateOf(s);
      let endDate = en && en.isDate ? dateOf(en) : null;
      if (!endDate || endDate <= startDate) {
        const next = s.clone();
        next.day += 1;
        endDate = dateOf(next);
      }
      const i = allDayInterval(startDate, endDate, timeZone);
      if (i.end > window.start && i.start < window.end) out.push({ externalId: key, title, start: i.start, end: i.end, allDay: true, startDate, endDateExclusive: endDate });
      return;
    }
    const start = instant(s, tzidOf(item, "dtstart"), timeZone);
    let end = en ? instant(en, tzidOf(item, "dtend"), timeZone) : start;
    if (!(end > start)) end = start + 30 * 60_000; // zero-length reminders still hold a short slot
    if (end - start > 14 * 86_400_000) end = start + 14 * 86_400_000;
    if (end > window.start && start < window.end) out.push({ externalId: key, title, start, end, allDay: false });
  };

  for (const e of masters.values()) {
    if (out.length >= MAX_OCCURRENCES) break;
    if (!e.isRecurring()) {
      push(e, e.uid, e.startDate, e.endDate);
      continue;
    }
    const it = e.iterator();
    let guard = 0;
    for (let next = it.next(); next && guard < 20_000; next = it.next(), guard++) {
      const details = e.getOccurrenceDetails(next);
      const item = details.item;
      // Stop once the original start is well past the window (a moved occurrence may land inside it).
      if (instant(details.recurrenceId, tzidOf(e, "dtstart"), timeZone) >= window.end + 14 * 86_400_000) break;
      push(item, `${e.uid}|${details.recurrenceId.toString()}`, details.startDate, details.endDate);
      if (out.length >= MAX_OCCURRENCES) break;
    }
  }
  return out;
}
