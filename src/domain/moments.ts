/**
 * Moments and dates (spec 8.5, 11.1). State is kept in independent
 * dimensions rather than one overloaded status string.
 */

export type MomentKind = "me" | "us" | "family";
export type Lifecycle = "draft" | "planned" | "completed" | "cancelled";
export type Sharing = "private" | "shared";
export type Decision = "accepted" | "alternative" | "declined";

export interface MomentFields {
  title: string;
  notes: string;
  start: number;
  end: number;
  travelBeforeMinutes: number;
  travelAfterMinutes: number;
  participantIds: readonly string[];
  childIds: readonly string[];
  needsCare: boolean;
  budgetMinor: number | null;
  location: string;
}

/**
 * Material-field policy: a change to time, people, care or committed money
 * invalidates agreement and task confirmations; wording edits do not.
 */
const MATERIAL: readonly (keyof MomentFields)[] = [
  "start",
  "end",
  "travelBeforeMinutes",
  "travelAfterMinutes",
  "participantIds",
  "childIds",
  "needsCare",
  "budgetMinor",
];

export function materialChanges(before: MomentFields, after: MomentFields): (keyof MomentFields)[] {
  return MATERIAL.filter((k) => JSON.stringify(normal(before[k])) !== JSON.stringify(normal(after[k])));
}

function normal(v: unknown): unknown {
  return Array.isArray(v) ? [...v].sort() : v;
}

export interface AcceptanceRecord {
  actorId: string;
  materialVersion: number;
  decision: Decision;
}

/**
 * Adults whose agreement is required: every current participant. The
 * organiser's agreement is recorded when they share or edit the plan, so a
 * partner's edit needs the organiser's answer too.
 */
export function requiredResponders(participantIds: readonly string[], currentAdultIds: readonly string[]): string[] {
  const current = new Set(currentAdultIds);
  return participantIds.filter((p) => current.has(p));
}

/**
 * Agreement belongs to a person and a version (INV-03). Old acceptances, or
 * acceptances by someone who is no longer a member, never count.
 */
export function isAgreed(
  participantIds: readonly string[],
  currentAdultIds: readonly string[],
  materialVersion: number,
  acceptances: readonly AcceptanceRecord[],
): boolean {
  if (participantIds.some((p) => !currentAdultIds.includes(p))) return false;
  const needed = requiredResponders(participantIds, currentAdultIds);
  return needed.every((id) =>
    latestDecision(acceptances, id, materialVersion) === "accepted",
  );
}

export function latestDecision(acceptances: readonly AcceptanceRecord[], actorId: string, materialVersion: number): Decision | null {
  const mine = acceptances.filter((a) => a.actorId === actorId && a.materialVersion === materialVersion);
  return mine.at(-1)?.decision ?? null;
}

export type ReadinessGap = "AGREEMENT" | "CARE" | "PREPARATION" | "CONFLICT";

export interface Readiness {
  ready: boolean;
  missing: ReadinessGap[];
}

/** Ready only when every required dependency passes (spec 11.1). */
export function readiness(input: {
  agreed: boolean;
  careCovered: boolean;
  needsCare: boolean;
  openTasks: number;
  conflicts: number;
}): Readiness {
  const missing: ReadinessGap[] = [];
  if (!input.agreed) missing.push("AGREEMENT");
  if (input.needsCare && !input.careCovered) missing.push("CARE");
  if (input.openTasks > 0) missing.push("PREPARATION");
  if (input.conflicts > 0) missing.push("CONFLICT");
  return { ready: missing.length === 0, missing };
}

/** The headline stage a person sees (spec 8.5): invited, agreed, ready, completed. */
export function stageLabel(m: { lifecycle: Lifecycle; sharing: Sharing; agreed: boolean; ready: boolean }): string {
  if (m.lifecycle === "cancelled") return "Cancelled";
  if (m.lifecycle === "completed") return "Completed";
  if (m.sharing === "private") return "Private draft";
  if (!m.agreed) return "Invited";
  if (!m.ready) return "Agreed";
  return "Arrangements ready";
}

/**
 * What a partner sees of another adult's shared me-time. "busy" shows only
 * that the time is taken; "details" would show its title and notes too.
 * Undecided product question: "busy" is the safe default.
 */
export const ME_TIME_PARTNER_VIEW: "busy" | "details" = "busy";

/** Why some of a moment's details are withheld from this viewer, if they are. */
export function hiddenReason(
  m: { kind: MomentKind; organiserId: string; surprise: boolean; lifecycle: Lifecycle },
  viewerId: string,
): "surprise" | "me_time" | null {
  if (m.organiserId === viewerId) return null;
  if (m.kind === "me" && ME_TIME_PARTNER_VIEW === "busy") return "me_time";
  if (m.surprise && m.lifecycle !== "completed") return "surprise";
  return null;
}
