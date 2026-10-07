import { describe, expect, it } from "vitest";
import { cadenceLabel, ritualDates } from "@/domain/rituals";

describe("ritual dates", () => {
  it("repeats weekly and fortnightly on the first date's weekday", () => {
    expect(ritualDates({ cadence: "weekly", startsOn: "2026-10-09" }, "2026-10-01", "2026-10-31")).toEqual(["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]);
    expect(ritualDates({ cadence: "fortnightly", startsOn: "2026-10-09" }, "2026-10-17", "2026-11-30")).toEqual(["2026-10-23", "2026-11-06", "2026-11-20"]);
  });

  it("keeps the nth weekday monthly, and a 5th weekday becomes the last", () => {
    expect(ritualDates({ cadence: "monthly", startsOn: "2026-10-10" }, "2026-10-01", "2027-01-31")).toEqual(["2026-10-10", "2026-11-14", "2026-12-12", "2027-01-09"]);
    expect(ritualDates({ cadence: "monthly", startsOn: "2026-10-31" }, "2026-10-01", "2026-12-31")).toEqual(["2026-10-31", "2026-11-28", "2026-12-26"]);
    expect(cadenceLabel("monthly", "2026-10-10")).toBe("The second Saturday of each month");
    expect(cadenceLabel("fortnightly", "2026-10-09")).toBe("Every other Friday");
  });
});
