/**
 * What's next for one adult: their next agreed plan, or the next children's
 * event they are down for (a pickup, a club), whichever comes first. A plan
 * still running counts, so the line doesn't jump ahead mid-afternoon.
 */

export interface NextInput {
  me: string;
  now: number;
  /** Agreed plans the viewer is in, already filtered by the caller. */
  moments: { id: string; title: string; start: number; end: number; travelBeforeMinutes: number }[];
  events: { id: string; recurrenceId: string | null; title: string; start: number; end: number; allDay: boolean; adultIds: string[]; childIds: string[]; detailsHidden: boolean; travelBeforeMinutes: number }[];
}

export interface NextItem {
  key: string;
  kind: "moment" | "duty";
  title: string;
  start: number;
  end: number;
  /** When to set off, while that's still ahead. */
  leaveBy: number | null;
  childIds: string[];
}

export function leaveByOf(start: number, travelBeforeMinutes: number, now: number): number | null {
  if (travelBeforeMinutes <= 0) return null;
  const at = start - travelBeforeMinutes * 60_000;
  return at > now ? at : null;
}

/** A children's event this adult is down for. */
export function isDuty(e: Pick<NextInput["events"][number], "allDay" | "detailsHidden" | "childIds" | "adultIds">, me: string): boolean {
  return !e.allDay && !e.detailsHidden && e.childIds.length > 0 && e.adultIds.includes(me);
}

export function nextUp(input: NextInput, horizonMs = 7 * 86_400_000): NextItem | null {
  const { me, now } = input;
  const until = now + horizonMs;
  const items: NextItem[] = [
    ...input.moments
      .filter((m) => m.end > now && m.start < until)
      .map((m) => ({ key: `m:${m.id}`, kind: "moment" as const, title: m.title, start: m.start, end: m.end, leaveBy: leaveByOf(m.start, m.travelBeforeMinutes, now), childIds: [] })),
    ...input.events
      .filter((e) => isDuty(e, me) && e.end > now && e.start < until)
      .map((e) => ({ key: `e:${e.id}:${e.start}`, kind: "duty" as const, title: e.title, start: e.start, end: e.end, leaveBy: leaveByOf(e.start, e.travelBeforeMinutes, now), childIds: e.childIds })),
  ];
  return items.sort((a, b) => a.start - b.start)[0] ?? null;
}
