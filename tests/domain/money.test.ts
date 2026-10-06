import { describe, expect, it } from "vitest";
import { allocate, formatMinor, parseMinor, summarise } from "@/domain/money";

describe("money (spec 8.9 completion test)", () => {
  it("£80 club for four children, £30 refunded: net £50, allocation exact", () => {
    const s = summarise({ estimateMinor: 8000, committedMinor: 8000 }, [
      { id: "p1", kind: "payment", amountMinor: 8000 },
      { id: "r1", kind: "refund", amountMinor: 3000 },
    ]);
    expect(s.netPaidMinor).toBe(5000);
    expect(formatMinor(s.netPaidMinor)).toBe("£50.00");
    expect(allocate(5000, [1, 1, 1, 1])).toEqual([1250, 1250, 1250, 1250]);
  });

  it("allocations always sum exactly", () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
  });

  it("parses pounds to pence without floats", () => {
    expect(parseMinor("£12.5")).toBe(1250);
    expect(parseMinor("0.07")).toBe(7);
    expect(() => parseMinor("12.345")).toThrow();
  });
});
