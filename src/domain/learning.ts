/**
 * Reflection and learning (spec 8.10, AT-15, AT-16). Explicit preferences
 * outrank inference; effort is separate from taste; a forgotten inference
 * is never silently recreated from the same evidence.
 */

export type Guidance = "allow" | "avoid" | "simplify";

export interface Feedback {
  id: string;
  activityKey: string;
  enjoyed: boolean | null;
  wantRepeat: boolean | null;
  effortOk: boolean | null;
}

export interface Preference {
  activityKey: string;
  guidance: Guidance;
}

export interface Inference {
  activityKey: string;
  guidance: Guidance;
  evidenceIds: string[];
  reason: string;
}

export interface Suppression {
  activityKey: string;
  evidenceIds: string[];
}

export function inferFromFeedback(feedback: readonly Feedback[]): Inference[] {
  const byKey = new Map<string, Feedback[]>();
  for (const f of feedback) byKey.set(f.activityKey, [...(byKey.get(f.activityKey) ?? []), f]);
  const out: Inference[] = [];
  for (const [activityKey, list] of byKey) {
    const latest = list.at(-1)!;
    const ids = list.map((f) => f.id);
    if (latest.wantRepeat === false && latest.enjoyed === false) {
      out.push({ activityKey, guidance: "avoid", evidenceIds: ids, reason: "Not enjoyed and not wanted again" });
    } else if (latest.wantRepeat !== false && latest.effortOk === false) {
      // "Too tired" alters execution, not taste (spec 8.10).
      out.push({ activityKey, guidance: "simplify", evidenceIds: ids, reason: "Worth repeating with less preparation" });
    }
  }
  return out;
}

/**
 * Effective guidance per activity. Explicit preference wins. A forgotten
 * inference stays forgotten even when new feedback arrives; only the owner
 * lifting the suppression brings inference back (AT-16).
 */
export function effectiveGuidance(
  preferences: readonly Preference[],
  inferences: readonly Inference[],
  suppressions: readonly Suppression[],
): Map<string, { guidance: Guidance; source: "explicit" | "inferred"; reason?: string }> {
  const out = new Map<string, { guidance: Guidance; source: "explicit" | "inferred"; reason?: string }>();
  for (const inf of inferences) {
    if (suppressions.some((s) => s.activityKey === inf.activityKey)) continue;
    out.set(inf.activityKey, { guidance: inf.guidance, source: "inferred", reason: inf.reason });
  }
  for (const p of preferences) out.set(p.activityKey, { guidance: p.guidance, source: "explicit" });
  return out;
}
