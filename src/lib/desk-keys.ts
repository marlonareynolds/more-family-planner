/**
 * Fingerprints for the Household Desk's duplicate check. The phone and the
 * server compute the same ones, so the phone can ask "is this already in the
 * diary?" by sending fingerprints only: no titles, no letter text (the rule
 * reader's promise that a letter never leaves the phone still holds).
 *
 * `seriesKey`: kind, title and children (two siblings stay distinct).
 * `identityKey`: that plus the first date and start time (two sessions, on two
 * days or one after the other, stay distinct).
 * `detailKey`: that plus times, end date, place, details, arrival time and
 * repeats and collection time: everything the letter decides, so a changed notice is told apart
 * from a repeat of the same one.
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
  arriveBy?: string | null;
  repeat?: string | null;
  repeatUntil?: string | null;
  /** When the children must be collected, for a pickup. */
  collectAt?: string | null;
}

/**
 * The times an item will hold in the diary: an event that says "arrive by
 * 08:30" starts then. Shared by the import and the phone's duplicate check,
 * so both compare the same thing.
 */
export function diaryTimes(i: Pick<KeyFields, "kind" | "allDay" | "startTime" | "endTime" | "endDate"> & { arriveBy?: string | null }) {
  if (i.kind === "holiday" || (i.kind === "event" && i.allDay) || (i.kind !== "trip" && !i.startTime)) return { startTime: null, endTime: null, endDate: i.endDate };
  if (i.kind === "trip") return { startTime: i.startTime ?? "09:00", endTime: i.endTime ?? "17:00", endDate: i.endDate };
  if (i.kind === "job") return { startTime: i.startTime, endTime: null, endDate: i.endDate };
  const start = i.kind === "event" && i.arriveBy && i.startTime && i.arriveBy < i.startTime ? i.arriveBy : i.startTime;
  return { startTime: start, endTime: i.endTime ?? start, endDate: i.endDate };
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
  const detailKey = await sha(identityKey, i.endDate, i.allDay ? "all-day" : `${i.startTime ?? ""}-${i.endTime ?? ""}`, normTitle(i.location), normTitle(i.details), i.arriveBy ?? "", i.repeat ?? "", i.repeatUntil ?? "",
    // Only when there is one, so items without a pickup keep the fingerprints they were stored with.
    ...(i.collectAt ? [`collect ${i.collectAt}`] : []));
  return { seriesKey, identityKey, detailKey };
}

/** A hand-made diary entry with this title on this day, for "looks like it's already there". */
export function dayTitleKey(householdId: string, date: string, title: string): Promise<string> {
  return sha(householdId, "day", date, normTitle(title));
}

/**
 * The heading above the lines the Desk writes into an entry's notes. Lines
 * under it belong to the letter and are replaced whole when a changed letter
 * is applied; anything above it, or after the last "• " line, is the
 * person's own and is kept.
 */
export const LETTER_HEADING = "From the letter:";

/** Put the letter's current lines into notes, replacing the letter's earlier ones and keeping the person's own. */
export function withLetterLines(existing: string, lines: string[]): string {
  const block = lines.length ? [LETTER_HEADING, ...lines.map((l) => `• ${l}`)] : [];
  const all = existing === "" ? [] : existing.split("\n");
  const at = all.indexOf(LETTER_HEADING);
  if (at === -1) return [...all, ...block].join("\n");
  let end = at + 1;
  while (end < all.length && all[end].startsWith("• ")) end++;
  return [...all.slice(0, at), ...block, ...all.slice(end)].join("\n");
}
