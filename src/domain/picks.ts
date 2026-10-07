import type { Activity } from "@/lib/catalogue";
import type { SuggestedTime } from "./free-time";

/**
 * "This week's picks" (spec 11.3 step 7): a few feasible options, each an
 * idea with its best time, ranked by fit, energy and variety. Hard
 * constraints have already filtered the candidates; this only orders them.
 */

export type GuidanceLevel = "allow" | "avoid" | "simplify";

export interface PickInput {
  candidates: Activity[];
  guidance: Record<string, { guidance: GuidanceLevel }>;
  /** Activities done or planned recently: offered last, for variety. */
  recent: ReadonlySet<string>;
  lighterWeek: boolean;
  /** Changes weekly so the same household sees different picks each week. */
  seed: string;
  count: number;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function choosePicks(input: PickInput): Activity[] {
  const scored = input.candidates
    .filter((a) => input.guidance[a.key]?.guidance !== "avoid")
    .map((a) => {
      let score = (hash(`${input.seed}:${a.key}`) % 1000) / 1000;
      if (input.guidance[a.key]?.guidance === "allow") score += 1.5;
      if (input.recent.has(a.key)) score -= 3;
      if (input.lighterWeek) score += a.preparation === "low" ? 1 : a.simpler ? 0.3 : -1;
      return { a, score };
    })
    .sort((x, y) => y.score - x.score);
  const out: Activity[] = [];
  // Different kinds of thing first: one cosy, one out, one active.
  for (const { a } of scored) {
    if (out.length >= input.count) break;
    if (out.some((o) => o.category === a.category || (o.setting === a.setting && out.length < 2))) continue;
    out.push(a);
  }
  for (const { a } of scored) {
    if (out.length >= input.count) break;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

/** Round a length to the free-time finder's half-hour steps. */
export function slotMinutes(a: Pick<Activity, "durationMinutes">): number | null {
  if (a.durationMinutes > 720) return null;
  return Math.max(30, Math.ceil(a.durationMinutes / 30) * 30);
}

/** Give each pick its best free time, on different days where possible. */
export function pairSlots<T extends { key: string }>(picks: T[], slotsFor: (pick: T) => SuggestedTime[]): (SuggestedTime | null)[] {
  const usedDays = new Set<string>();
  return picks.map((p) => {
    const options = [...slotsFor(p)].sort((a, b) => b.score - a.score || a.start - b.start);
    const best = options.find((o) => !usedDays.has(o.date)) ?? options[0] ?? null;
    if (best) usedDays.add(best.date);
    return best;
  });
}
