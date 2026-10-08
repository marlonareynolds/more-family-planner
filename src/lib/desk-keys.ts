/**
 * Fingerprints for the Household Desk's duplicate check. The phone and the
 * server compute the same ones, so the phone can ask "is this already in the
 * diary?" by sending fingerprints only: no titles, no letter text (the rule
 * reader's promise that a letter never leaves the phone still holds).
 *
 * `seriesKey`: kind, title and children (two siblings stay distinct).
 * `identityKey`: that plus the first date and start time (two sessions, on two
 * days or one after the other, stay distinct).
 * `detailKey`: that plus times, end date, place and details, so a changed
 * notice is told apart from a repeat of the same one.
 * `scope` is the adder's id for a "just for me" item, so it never matches,
 * or collides with, anyone else's.
 */

export interface KeyFields {
  kind: "event" | "trip" | "holiday" | "job";
  title: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  location: string;
  details: string;
  childIds: string[];
}

export function normTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\b(?:the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function sha(...parts: string[]): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\u001f")));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

export async function deskKeys(householdId: string, i: KeyFields, scope: string | null) {
  const children = [...new Set(i.childIds)].sort().join(",");
  const seriesKey = await sha(householdId, scope ?? "shared", i.kind, normTitle(i.title), children);
  const identityKey = await sha(seriesKey, i.startDate, i.allDay ? "all-day" : (i.startTime ?? ""));
  const detailKey = await sha(identityKey, i.endDate, i.allDay ? "all-day" : `${i.startTime ?? ""}-${i.endTime ?? ""}`, normTitle(i.location), normTitle(i.details));
  return { seriesKey, identityKey, detailKey };
}

/** A hand-made diary entry with this title on this day, for "looks like it's already there". */
export function dayTitleKey(householdId: string, date: string, title: string): Promise<string> {
  return sha(householdId, "day", date, normTitle(title));
}
