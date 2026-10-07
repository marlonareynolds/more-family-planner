import { describe, expect, it } from "vitest";
import { commonFreeWindows, findConflicts, type Busy } from "@/domain/availability";

const H = 3_600_000;
const busy = (o: Partial<Busy>): Busy => ({ personId: "a", start: 0, end: H, sourceType: "event", sourceId: "e1", ownerId: "a", visibility: "busy_only", title: "Therapy", ...o });

describe("availability (AT-09, AT-13)", () => {
  it("travel expands occupancy and crosses midnight", () => {
    const late = busy({ start: 22 * H, end: 23 * H, travelAfterMinutes: 90 });
    const c = findConflicts({ personIds: ["a"], start: 24 * H, end: 25 * H }, [late], "a");
    expect(c).toHaveLength(1);
    expect(c[0].end).toBe(24.5 * H);
  });

  it("a partner sees only that a private item is busy", () => {
    const c = findConflicts({ personIds: ["a"], start: 0, end: H }, [busy({})], "b");
    expect(c[0].title).toBeUndefined();
    expect(c[0].sourceId).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain("Therapy");
  });

  it("organisers who are not attending are not reserved", () => {
    expect(findConflicts({ personIds: ["b"], start: 0, end: H }, [busy({})], "b")).toEqual([]);
  });

  it("finds common free windows", () => {
    const w = commonFreeWindows(["a", "b"], { start: 0, end: 10 * H }, [busy({ start: 2 * H, end: 3 * H }), busy({ personId: "b", start: 5 * H, end: 6 * H })], 60);
    expect(w).toEqual([{ start: 0, end: 2 * H }, { start: 3 * H, end: 5 * H }, { start: 6 * H, end: 10 * H }]);
  });
});
