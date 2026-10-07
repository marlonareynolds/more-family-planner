import { describe, expect, it } from "vitest";
import { gaps, isCovered, overlaps, union } from "@/domain/intervals";

describe("intervals", () => {
  it("adjacent half-open intervals do not overlap", () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(overlaps({ start: 0, end: 11 }, { start: 10, end: 20 })).toBe(true);
  });

  it("union merges touching pieces and coverage spans them", () => {
    const u = union([{ start: 10, end: 20 }, { start: 0, end: 10 }, { start: 30, end: 40 }]);
    expect(u).toEqual([{ start: 0, end: 20 }, { start: 30, end: 40 }]);
    expect(isCovered({ start: 0, end: 20 }, u)).toBe(true);
    expect(gaps({ start: 0, end: 40 }, u)).toEqual([{ start: 20, end: 30 }]);
  });
});
