import { overlaps, subtract, union, withTravel, type Interval } from "./intervals";

/**
 * Availability and conflicts (spec 11.3). One function answers week
 * planning, date acceptance, care confirmation and research validation.
 */

export type Visibility = "shared" | "busy_only" | "private";

export type SourceType = "event" | "date" | "care" | "handover" | "external";

/** A span of time that occupies one person. */
export interface Busy {
  personId: string;
  start: number;
  end: number;
  travelBeforeMinutes?: number;
  travelAfterMinutes?: number;
  sourceType: SourceType;
  sourceId: string;
  /** Occurrence identity for recurring sources. */
  occurrenceId?: string;
  ownerId: string;
  visibility: Visibility;
  title: string;
  /** Stale external calendars make availability uncertain (spec 8.11). */
  uncertain?: boolean;
}

export type ConflictCode =
  | "PARTICIPANT_BUSY"
  | "CARE_GAP"
  | "HANDOVER_PENDING"
  | "STALE_CALENDAR"
  | "BUDGET_REVIEW";

export interface Conflict {
  code: ConflictCode;
  personId?: string;
  childId?: string;
  start: number;
  end: number;
  sourceType?: SourceType;
  sourceId?: string;
  /** Only present when the viewer may see the source's details. */
  title?: string;
}

export function occupied(b: Busy): Interval {
  return withTravel(b, b.travelBeforeMinutes, b.travelAfterMinutes);
}

/** Whether `viewerId` may see a busy item's title and details (INV-01, AT-13). */
export function canSeeDetails(b: Pick<Busy, "ownerId" | "visibility">, viewerId: string): boolean {
  return b.ownerId === viewerId || b.visibility === "shared";
}

export interface Candidate {
  personIds: readonly string[];
  start: number;
  end: number;
  travelBeforeMinutes?: number;
  travelAfterMinutes?: number;
  /** Sources to ignore, e.g. the item being edited. */
  excludeSourceIds?: readonly string[];
}

export function findConflicts(candidate: Candidate, busy: readonly Busy[], viewerId: string): Conflict[] {
  const span = withTravel(candidate, candidate.travelBeforeMinutes, candidate.travelAfterMinutes);
  const people = new Set(candidate.personIds);
  const excluded = new Set(candidate.excludeSourceIds ?? []);
  const out: Conflict[] = [];
  for (const b of busy) {
    if (!people.has(b.personId) || excluded.has(b.sourceId)) continue;
    const occ = occupied(b);
    if (!overlaps(span, occ)) continue;
    out.push({
      code: b.uncertain ? "STALE_CALENDAR" : "PARTICIPANT_BUSY",
      personId: b.personId,
      start: occ.start,
      end: occ.end,
      sourceType: b.sourceType,
      sourceId: canSeeDetails(b, viewerId) ? b.sourceId : undefined,
      title: canSeeDetails(b, viewerId) ? b.title : undefined,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Windows within `horizon` when every listed person is free. */
export function commonFreeWindows(
  personIds: readonly string[],
  horizon: Interval,
  busy: readonly Busy[],
  minMinutes = 0,
): Interval[] {
  const people = new Set(personIds);
  const blocked = union(busy.filter((b) => people.has(b.personId)).map(occupied));
  return subtract(horizon, blocked).filter((w) => w.end - w.start >= minMinutes * 60_000);
}

/** A display-safe copy of a busy item for `viewerId` (busy-only projection). */
export function projectBusy(b: Busy, viewerId: string): Busy {
  if (canSeeDetails(b, viewerId)) return b;
  return { ...b, title: "Busy", sourceId: "", occurrenceId: undefined };
}
