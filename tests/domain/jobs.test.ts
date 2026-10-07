import { describe, expect, it } from "vitest";
import { buildCalendar, fold } from "@/domain/ics-out";
import { jobDates, jobStatus, monthlyMinutes } from "@/domain/jobs";

describe("job dates", () => {
  it("weekly jobs keep their weekday; once and yearly behave", () => {
    expect(jobDates({ cadence: "weekly", startsOn: "2030-10-08" }, "2030-10-01", "2030-10-22")).toEqual(["2030-10-08", "2030-10-15", "2030-10-22"]);
    expect(jobDates({ cadence: "once", startsOn: "2030-10-08" }, "2030-10-01", "2030-10-31")).toEqual(["2030-10-08"]);
    expect(jobDates({ cadence: "yearly", startsOn: "2028-02-29" }, "2029-01-01", "2030-12-31")).toEqual(["2029-02-28", "2030-02-28"]);
  });

  it("only the latest missed date counts, never a backlog", () => {
    const bins = { cadence: "weekly" as const, startsOn: "2030-10-01" };
    // Tuesday bins: on Thursday the 10th, last Tuesday (8th) is overdue.
    expect(jobStatus(bins, "2030-10-10", new Set())).toEqual({ status: "overdue", dueOn: "2030-10-08" });
    // Done: next Tuesday is up next.
    expect(jobStatus(bins, "2030-10-10", new Set(["2030-10-08"]))).toEqual({ status: "upcoming", dueOn: "2030-10-15" });
    expect(jobStatus(bins, "2030-10-15", new Set(["2030-10-08"]))).toEqual({ status: "today", dueOn: "2030-10-15" });
    // A one-off job, done, is finished.
    expect(jobStatus({ cadence: "once", startsOn: "2030-10-08" }, "2030-10-10", new Set(["2030-10-08"])).status).toBe("done");
  });

  it("monthly minutes for the share view", () => {
    expect(monthlyMinutes("weekly", 12)).toBe(52);
    expect(monthlyMinutes("once", 60)).toBe(0);
  });
});

describe("calendar out", () => {
  it("escapes text and folds long lines at 75 octets", () => {
    const ics = buildCalendar("More: The Reynolds", [
      { uid: "moment-1@more", start: Date.UTC(2030, 9, 11, 18, 30), end: Date.UTC(2030, 9, 11, 21), summary: "Dinner, then a walk; maybe", description: "x".repeat(200), status: "CONFIRMED", sequence: 2, stamp: Date.UTC(2030, 9, 1) },
    ]);
    expect(ics).toContain("SUMMARY:Dinner\\, then a walk\\; maybe\r\n");
    expect(ics).toContain("DTSTART:20301011T183000Z");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(fold("é".repeat(60)).split("\r\n ").join("")).toBe("é".repeat(60));
  });
});
