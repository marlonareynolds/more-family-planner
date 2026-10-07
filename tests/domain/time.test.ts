import { describe, expect, it } from "vitest";
import { allDayInterval, localToInstant, weekInterval, weekKeyFor } from "@/domain/time";
import { DomainError } from "@/domain/errors";

const LONDON = "Europe/London";

describe("time (AT-10)", () => {
  it("rejects a time inside the spring-forward gap with a suggestion", () => {
    try {
      localToInstant("2026-03-29T01:30", LONDON);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("DST_GAP");
      expect((e as DomainError).details?.suggestion).toBe("2026-03-29T02:30");
    }
  });

  it("requires an explicit choice for the repeated autumn hour", () => {
    expect(() => localToInstant("2026-10-25T01:30", LONDON)).toThrow(/happens twice/);
    const earlier = localToInstant("2026-10-25T01:30", LONDON, "earlier");
    const later = localToInstant("2026-10-25T01:30", LONDON, "later");
    expect(later - earlier).toBe(3_600_000);
    expect(new Date(earlier).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("uses the household timezone, not the server's", () => {
    expect(new Date(localToInstant("2026-07-01T09:00", LONDON)).toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(new Date(localToInstant("2026-07-01T09:00", "America/New_York")).toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("week keys are Mondays and a DST week is 167 hours long", () => {
    expect(weekKeyFor("2026-10-25")).toBe("2026-10-19");
    const w = weekInterval("2026-03-23", LONDON);
    expect((w.end - w.start) / 3_600_000).toBe(167);
  });

  it("all-day spans use local dates with an exclusive end", () => {
    const i = allDayInterval("2026-12-25", "2026-12-26", LONDON);
    expect(new Date(i.start).toISOString()).toBe("2026-12-25T00:00:00.000Z");
    expect((i.end - i.start) / 3_600_000).toBe(24);
  });
});
