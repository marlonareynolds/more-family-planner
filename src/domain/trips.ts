import { intersect, union, type Interval } from "./intervals";
import { instantToLocal, localToInstantCompatible } from "./time";

/**
 * Time away (blueprint: "trips and holidays are projects"). One entry makes
 * its travellers away, and works out the care it creates for children left
 * at home, so nobody has to think of each pickup and bedtime separately.
 *
 * - Nobody left at home: the children need care for the whole trip.
 * - One adult left at home: they are on their own, so any of their own
 *   commitments in the children's home hours becomes a care need.
 */

/** When children are at home and awake, by day of the week (1 = Monday). */
export const HOME_HOURS = { weekday: ["15:00", "20:30"], weekend: ["08:00", "20:30"] } as const;

export interface TripInput {
  id: string;
  start: number;
  end: number;
  travellerIds: readonly string[];
  /** Children going on the trip. */
  childIds: readonly string[];
}

export interface StayerCommitment {
  personId: string;
  start: number;
  end: number;
  /** Children who come along to it. */
  childIds: readonly string[];
}

export interface TripCareNeed {
  id: string;
  childId: string;
  start: number;
  end: number;
  reason: string;
}

/** Each local day's home hours that fall inside a span. */
export function homeHours(span: Interval, timeZone: string): Interval[] {
  const out: Interval[] = [];
  let day = instantToLocal(span.start, timeZone).toPlainDate();
  const last = instantToLocal(span.end, timeZone).toPlainDate();
  while (day.until(last).days >= 0) {
    const [from, to] = day.dayOfWeek >= 6 ? HOME_HOURS.weekend : HOME_HOURS.weekday;
    const window = { start: localToInstantCompatible(`${day}T${from}`, timeZone), end: localToInstantCompatible(`${day}T${to}`, timeZone) };
    const inside = intersect(window, span);
    if (inside) out.push(inside);
    day = day.add({ days: 1 });
  }
  return out;
}

/** A span cut at local midnight, so each day shows its own part. */
export function byDay(span: Interval, timeZone: string): Interval[] {
  const out: Interval[] = [];
  let day = instantToLocal(span.start, timeZone).toPlainDate();
  while (true) {
    const next = day.add({ days: 1 });
    const part = intersect({ start: localToInstantCompatible(`${day}T00:00`, timeZone), end: localToInstantCompatible(`${next}T00:00`, timeZone) }, span);
    if (!part) break;
    out.push(part);
    day = next;
  }
  return out;
}

export function tripCareNeeds(input: {
  trip: TripInput;
  adultIds: readonly string[];
  childIds: readonly string[];
  commitments: readonly StayerCommitment[];
  reason: string;
  timeZone: string;
}): TripCareNeed[] {
  const { trip } = input;
  const home = input.childIds.filter((c) => !trip.childIds.includes(c));
  if (!home.length) return [];
  const stayers = input.adultIds.filter((a) => !trip.travellerIds.includes(a));
  const span = { start: trip.start, end: trip.end };
  const out: TripCareNeed[] = [];
  for (const childId of home) {
    const busy = union(input.commitments.filter((c) => stayers.includes(c.personId) && !c.childIds.includes(childId)).map((c) => ({ start: c.start, end: c.end })));
    const needs: Interval[] = stayers.length
      ? homeHours(span, input.timeZone).flatMap((h) => busy.map((b) => intersect(h, b)).filter((i): i is Interval => !!i))
      : byDay(span, input.timeZone);
    for (const n of needs) out.push({ id: `trip:${trip.id}:${childId}:${n.start}`, childId, start: n.start, end: n.end, reason: input.reason });
  }
  return out;
}
