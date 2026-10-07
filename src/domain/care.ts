import { DomainError } from "./errors";
import { gaps, intersect, subtract, union, type Interval } from "./intervals";

/**
 * Care coverage (spec 8.8, 11.1, INV-05, INV-06).
 * A child is covered only for the union of valid confirmed intervals that
 * covers the entire required interval.
 */

export type ArrangementKind = "parent" | "external" | "not_needed";
export type ArrangementState = "proposed" | "confirmed" | "declined";

export interface CareRequirement {
  id: string;
  childId: string;
  start: number;
  end: number;
}

export interface CareArrangement {
  id: string;
  kind: ArrangementKind;
  /** For kind "parent": the adult who will look after the children. */
  responsibleAccountId: string | null;
  /** Free-text name of an external carer or club ("Nana", "Holiday club"). */
  providerName: string | null;
  childIds: readonly string[];
  start: number;
  end: number;
  state: ArrangementState;
}

export type CoverageState = "covered" | "partly_covered" | "unresolved";

export interface ChildCoverage {
  requirementId: string;
  childId: string;
  state: CoverageState;
  gaps: Interval[];
  arrangementIds: string[];
}

/**
 * Who may confirm an arrangement (AT-07). A parent confirms only their own
 * responsibility; any current adult may record that an external carer or
 * club has confirmed, or that no separate care is needed.
 */
export function assertCanConfirm(arrangement: Pick<CareArrangement, "kind" | "responsibleAccountId">, actorId: string): void {
  if (arrangement.kind === "parent" && arrangement.responsibleAccountId !== actorId) {
    throw new DomainError("FORBIDDEN", "Only the named parent can confirm their own care.");
  }
}

/**
 * Coverage for one requirement. Parent care is invalid wherever that parent
 * is busy with something else (AT-12): pass those intervals in `parentBusy`.
 */
export function coverageFor(
  requirement: CareRequirement,
  arrangements: readonly CareArrangement[],
  parentBusy: ReadonlyMap<string, readonly Interval[]> = new Map(),
): ChildCoverage {
  const valid: Interval[] = [];
  const used: string[] = [];
  for (const a of arrangements) {
    if (a.state !== "confirmed" || !a.childIds.includes(requirement.childId)) continue;
    const overlap = intersect(a, requirement);
    if (!overlap) continue;
    let pieces: Interval[] = [overlap];
    if (a.kind === "parent" && a.responsibleAccountId) {
      pieces = subtract(overlap, parentBusy.get(a.responsibleAccountId) ?? []);
    }
    if (pieces.length) {
      valid.push(...pieces);
      used.push(a.id);
    }
  }
  const missing = gaps(requirement, union(valid));
  const state: CoverageState = missing.length === 0 ? "covered" : valid.length ? "partly_covered" : "unresolved";
  return { requirementId: requirement.id, childId: requirement.childId, state, gaps: missing, arrangementIds: used };
}

export interface CareGroup {
  key: string;
  childIds: string[];
  arrangementIds: string[];
  state: CoverageState;
}

/**
 * Group children who share exactly the same arrangements and state, so the
 * calendar shows one card per real arrangement and splits only genuine
 * differences (spec 6.3, AT-11).
 */
export function groupCoverage(coverages: readonly ChildCoverage[]): CareGroup[] {
  const groups = new Map<string, CareGroup>();
  for (const c of coverages) {
    const key = `${c.state}|${[...c.arrangementIds].sort().join(",")}|${c.gaps.map((g) => `${g.start}-${g.end}`).join(",")}`;
    const g = groups.get(key) ?? { key, childIds: [], arrangementIds: [...c.arrangementIds].sort(), state: c.state };
    if (!g.childIds.includes(c.childId)) g.childIds.push(c.childId);
    groups.set(key, g);
  }
  return [...groups.values()];
}
