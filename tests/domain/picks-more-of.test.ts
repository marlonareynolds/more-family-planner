import { describe, expect, it } from "vitest";
import { choosePicks, wantMatches } from "@/domain/picks";
import { CATALOGUE } from "@/lib/catalogue";

const me = CATALOGUE.filter((a) => a.kind === "me");
const base = { candidates: me, guidance: {}, recent: new Set<string>(), lighterWeek: false, seed: "h:2030-10-07", count: 3 };

describe("check-in wants shape the adult's own picks (integration brief)", () => {
  it("brings ideas that answer this week's 'what would help' forward", () => {
    const plain = choosePicks(base).map((a) => a.key);
    const exercise = choosePicks({ ...base, moreOf: ["exercise"] });
    expect(exercise.some((a) => a.category === "active")).toBe(true);
    expect(wantMatches("exercise", exercise[0])).toBe(true);
    const sleep = choosePicks({ ...base, moreOf: ["sleep"] });
    expect(["me-lie-in", "me-nothing", "me-bath"]).toContain(sleep[0].key);
    // With nothing said, nothing changes.
    expect(choosePicks({ ...base, moreOf: [] }).map((a) => a.key)).toEqual(plain);
  });

  it("never brings back an idea the adult asked to avoid, and explicit preferences count for more", () => {
    const active = me.filter((a) => a.category === "active").map((a) => a.key);
    const avoid = Object.fromEntries(active.map((k) => [k, { guidance: "avoid" as const }]));
    const out = choosePicks({ ...base, guidance: avoid, moreOf: ["exercise"] });
    expect(out.some((a) => active.includes(a.key))).toBe(false);
    // "Suggest it" on a quiet idea outranks a weekly wish for exercise.
    const allow = choosePicks({ ...base, guidance: { "me-read": { guidance: "allow" } }, moreOf: ["exercise"] });
    expect(allow[0].key).toBe("me-read");
  });

  it("treats couple time and family time as which space, not which idea", () => {
    const plain = choosePicks(base).map((a) => a.key);
    expect(choosePicks({ ...base, moreOf: ["couple time", "family time"] }).map((a) => a.key)).toEqual(plain);
  });
});
