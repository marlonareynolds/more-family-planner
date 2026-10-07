import { describe, expect, it } from "vitest";
import { expand, isOccurrence, splitSeries, type SeriesDefinition } from "@/domain/recurrence";
import { localToInstant, weekInterval } from "@/domain/time";

const TZ = "Europe/London";
const iso = (ms: number) => new Date(ms).toISOString();

describe("recurrence (AT-19)", () => {
  const swim: SeriesDefinition = {
    localStart: "2026-10-05T17:00",
    timeZone: TZ,
    allDay: false,
    durationMinutes: 60,
    rule: { freq: "WEEKLY", byDay: ["MO", "TH"] },
  };

  it("keeps local wall-clock time across the October clock change", () => {
    const occ = expand(swim, { start: localToInstant("2026-10-19T00:00", TZ), end: localToInstant("2026-11-02T00:00", TZ) });
    expect(occ.map((o) => o.recurrenceId)).toEqual([
      "2026-10-19T17:00", "2026-10-22T17:00", "2026-10-26T17:00", "2026-10-29T17:00",
    ]);
    expect(iso(occ[0].start)).toBe("2026-10-19T16:00:00.000Z"); // BST
    expect(iso(occ[2].start)).toBe("2026-10-26T17:00:00.000Z"); // GMT
  });

  it("a moved occurrence keeps its identity and shows in its new week only", () => {
    const moved = { recurrenceId: "2026-10-22T17:00", kind: "moved" as const, start: localToInstant("2026-10-27T18:00", TZ), end: localToInstant("2026-10-27T19:00", TZ) };
    const w43 = expand(swim, weekInterval("2026-10-19", TZ), [moved]);
    const w44 = expand(swim, weekInterval("2026-10-26", TZ), [moved]);
    expect(w43.map((o) => o.recurrenceId)).toEqual(["2026-10-19T17:00"]);
    expect(w44.map((o) => [o.recurrenceId, o.moved])).toEqual([
      ["2026-10-26T17:00", false], ["2026-10-22T17:00", true], ["2026-10-29T17:00", false],
    ]);
  });

  it("a moved occurrence from a later week can appear earlier", () => {
    const moved = { recurrenceId: "2026-11-05T17:00", kind: "moved" as const, start: localToInstant("2026-10-20T10:00", TZ), end: localToInstant("2026-10-20T11:00", TZ) };
    const w43 = expand(swim, weekInterval("2026-10-19", TZ), [moved]);
    expect(w43.map((o) => o.recurrenceId)).toContain("2026-11-05T17:00");
  });

  it("cancelled occurrences disappear", () => {
    const occ = expand(swim, weekInterval("2026-10-19", TZ), [{ recurrenceId: "2026-10-19T17:00", kind: "cancelled" }]);
    expect(occ.map((o) => o.recurrenceId)).toEqual(["2026-10-22T17:00"]);
  });

  it("leap-day yearly events occur only in leap years", () => {
    const birthday: SeriesDefinition = { localStart: "2028-02-29T00:00", timeZone: TZ, allDay: true, durationMinutes: 1440, rule: { freq: "YEARLY" } };
    const occ = expand(birthday, { start: Date.UTC(2028, 0, 1), end: Date.UTC(2037, 0, 1) });
    expect(occ.map((o) => o.recurrenceId.slice(0, 10))).toEqual(["2028-02-29", "2032-02-29", "2036-02-29"]);
  });

  it("monthly on the 31st skips short months and counts only real dates", () => {
    const def: SeriesDefinition = { localStart: "2026-01-31T09:00", timeZone: TZ, allDay: false, durationMinutes: 30, rule: { freq: "MONTHLY", count: 3 } };
    const occ = expand(def, { start: Date.UTC(2026, 0, 1), end: Date.UTC(2027, 0, 1) });
    expect(occ.map((o) => o.recurrenceId.slice(0, 10))).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("'this and future' splits with an explicit cutover and preserves count", () => {
    const def: SeriesDefinition = { ...swim, rule: { freq: "WEEKLY", byDay: ["MO"], count: 6 } };
    const { before, after } = splitSeries(def, "2026-10-19T17:00", { localStart: "2026-10-19T18:00" });
    const all = { start: Date.UTC(2026, 9, 1), end: Date.UTC(2027, 0, 1) };
    expect(expand(before, all).map((o) => o.recurrenceId)).toEqual(["2026-10-05T17:00", "2026-10-12T17:00"]);
    expect(expand(after, all).map((o) => o.recurrenceId)).toEqual([
      "2026-10-19T18:00", "2026-10-26T18:00", "2026-11-02T18:00", "2026-11-09T18:00",
    ]);
  });

  it("validates occurrence identities", () => {
    expect(isOccurrence(swim, "2026-10-08T17:00")).toBe(true);
    expect(isOccurrence(swim, "2026-10-07T17:00")).toBe(false);
  });
});
