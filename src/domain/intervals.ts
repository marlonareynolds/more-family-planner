/**
 * Half-open intervals [start, end) in epoch milliseconds (spec 11.2).
 * Adjacent intervals do not overlap.
 */
export interface Interval {
  start: number;
  end: number;
}

export function interval(start: number, end: number): Interval {
  if (!(end > start)) throw new RangeError("Interval must have positive duration");
  return { start, end };
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

/** Merge overlapping or touching intervals into a sorted, disjoint list. */
export function union(list: readonly Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out.at(-1);
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** Parts of `base` not covered by any of `remove`. */
export function subtract(base: Interval, remove: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [{ ...base }];
  for (const r of union(remove)) {
    const next: Interval[] = [];
    for (const p of pieces) {
      if (!overlaps(p, r)) {
        next.push(p);
        continue;
      }
      if (r.start > p.start) next.push({ start: p.start, end: r.start });
      if (r.end < p.end) next.push({ start: r.end, end: p.end });
    }
    pieces = next;
  }
  return pieces;
}

/** Uncovered parts of `required` given coverage intervals (spec INV-05). */
export function gaps(required: Interval, coverage: readonly Interval[]): Interval[] {
  return subtract(required, coverage);
}

export function isCovered(required: Interval, coverage: readonly Interval[]): boolean {
  return gaps(required, coverage).length === 0;
}

/** Expand an interval by travel time before and after. */
export function withTravel(i: Interval, beforeMinutes = 0, afterMinutes = 0): Interval {
  return { start: i.start - beforeMinutes * 60_000, end: i.end + afterMinutes * 60_000 };
}
