import { describe, expect, it } from "vitest";
import { isAgreed, materialChanges, readiness, type MomentFields } from "@/domain/moments";
import { effectiveGuidance, inferFromFeedback } from "@/domain/learning";

const base: MomentFields = { title: "Dinner", notes: "", start: 0, end: 1, travelBeforeMinutes: 0, travelAfterMinutes: 0, participantIds: ["a", "b"], childIds: [], needsCare: true, budgetMinor: 6000, location: "" };

describe("moments (AT-03, INV-03)", () => {
  it("wording edits are not material; time and money are", () => {
    expect(materialChanges(base, { ...base, title: "Supper", notes: "x" })).toEqual([]);
    expect(materialChanges(base, { ...base, start: 5 })).toEqual(["start"]);
    expect(materialChanges(base, { ...base, participantIds: ["b", "a"] })).toEqual([]);
    expect(materialChanges(base, { ...base, budgetMinor: 8000 })).toEqual(["budgetMinor"]);
  });

  it("acceptance counts only for the current version and current members", () => {
    const acc = [
      { actorId: "a", materialVersion: 1, decision: "accepted" as const },
      { actorId: "b", materialVersion: 1, decision: "accepted" as const },
    ];
    expect(isAgreed(["a", "b"], ["a", "b"], 1, acc)).toBe(true);
    expect(isAgreed(["a", "b"], ["a", "b"], 2, acc)).toBe(false);
    expect(isAgreed(["a", "b"], ["a", "b"], 1, acc.slice(1))).toBe(false);
    // b has left and c has joined: old consent never transfers.
    expect(isAgreed(["a", "c"], ["a", "c"], 1, acc)).toBe(false);
    expect(isAgreed(["a", "b"], ["a", "c"], 1, acc)).toBe(false);
  });

  it("readiness lists every missing dependency", () => {
    expect(readiness({ agreed: true, careCovered: false, needsCare: true, openTasks: 1, conflicts: 0 }).missing).toEqual(["CARE", "PREPARATION"]);
  });
});

describe("learning (AT-15, AT-16)", () => {
  it("repeat=yes, effort=no simplifies rather than excludes", () => {
    const inf = inferFromFeedback([{ id: "f1", activityKey: "theatre", enjoyed: true, wantRepeat: true, effortOk: false }]);
    expect(inf[0].guidance).toBe("simplify");
  });

  it("explicit preference outranks inference; forgetting is durable", () => {
    const inf = inferFromFeedback([
      { id: "f1", activityKey: "theatre", enjoyed: false, wantRepeat: false, effortOk: true },
      { id: "f2", activityKey: "theatre", enjoyed: false, wantRepeat: false, effortOk: true },
    ]);
    expect(effectiveGuidance([], inf, [{ activityKey: "theatre", evidenceIds: ["f1"] }]).has("theatre")).toBe(false);
    expect(effectiveGuidance([{ activityKey: "theatre", guidance: "allow" }], inf, []).get("theatre")?.guidance).toBe("allow");
  });
});
