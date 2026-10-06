import { describe, expect, it } from "vitest";
import { CATALOGUE, matchActivities } from "@/lib/catalogue";

describe("idea catalogue", () => {
  it("has unique keys and a review date on every idea", () => {
    expect(new Set(CATALOGUE.map((a) => a.key)).size).toBe(CATALOGUE.length);
    for (const a of CATALOGUE) expect(a.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gives each kind of time enough to choose from", () => {
    for (const kind of ["me", "us", "family"] as const) expect(CATALOGUE.filter((a) => a.kind === kind).length).toBeGreaterThanOrEqual(10);
  });

  it("filters rain, calm, step-free and length as hard constraints", () => {
    const rain = matchActivities({ kind: "family", rainProof: true });
    expect(rain.every((a) => !a.weatherSensitive || a.backup)).toBe(true);
    expect(rain.some((a) => a.key === "fam-woodland-walk")).toBe(true);
    expect(rain.some((a) => a.key === "fam-cycle")).toBe(false);
    expect(matchActivities({ kind: "family", calm: true }).every((a) => a.sensoryLoad !== "high")).toBe(true);
    expect(matchActivities({ kind: "us", stepFree: true }).every((a) => a.stepFree)).toBe(true);
    expect(matchActivities({ kind: "me", maxMinutes: 60 }).every((a) => a.durationMinutes <= 60)).toBe(true);
  });

  it("only offers family ideas that suit every child's age", () => {
    const toddlers = matchActivities({ kind: "family", childAgeBands: ["0-4"] });
    expect(toddlers.some((a) => a.key === "fam-teen-cafe")).toBe(false);
    expect(toddlers.some((a) => a.key === "fam-soft-play")).toBe(true);
  });
});
