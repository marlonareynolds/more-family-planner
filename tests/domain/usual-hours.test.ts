import { describe, expect, it } from "vitest";
import { allAtSchool, usualHours } from "@/domain/usual-hours";
import { localToInstantCompatible } from "@/domain/time";

/**
 * Review (27 Oct 2026, thread 2): Family offered "Cinema trip, Tue 27 Oct
 * 11:00–14:00, Everyone's free" for a 5 to 7 year old. School and working
 * hours are now assumed until the household says otherwise.
 */

const TZ = "Europe/London";
const at = (s: string) => localToInstantCompatible(s, TZ);
const kids = [
  { id: "mia", ageBand: "5-7" },
  { id: "baby", ageBand: "0-4" },
];

describe("usual school and working hours", () => {
  it("gives school-age children a school day on weekdays only, and the adults a working day", () => {
    // 2026-10-26 is a Monday.
    const u = usualHours({ timeZone: TZ, from: "2026-10-24", days: 7, workers: ["alex"], children: kids, breaks: [] });
    expect(u.school.map((s) => s.childId)).toEqual(["mia", "mia", "mia", "mia", "mia"]);
    expect(u.school[0]).toMatchObject({ start: at("2026-10-26T08:30"), end: at("2026-10-26T15:30") });
    expect(u.work).toHaveLength(5);
    expect(u.work[0]).toMatchObject({ personId: "alex", start: at("2026-10-26T09:00"), end: at("2026-10-26T17:30") });
  });

  it("school holidays and INSET days free the children named; bank holidays free everyone", () => {
    const u = usualHours({
      timeZone: TZ,
      from: "2026-10-26",
      days: 5,
      workers: ["alex"],
      children: [...kids, { id: "leo", ageBand: "8-11" }],
      breaks: [{ startDate: "2026-10-26", endDateExclusive: "2026-10-28", childIds: ["mia"] }],
      dayOff: (d) => d === "2026-10-30",
    });
    const days = (id: string) => u.school.filter((s) => s.childId === id).length;
    expect(days("mia")).toBe(2); // Wed, Thu
    expect(days("leo")).toBe(4); // not the bank holiday
    expect(u.work).toHaveLength(4);
  });

  it("an adult who has told More their own pattern gets no assumed hours", () => {
    expect(usualHours({ timeZone: TZ, from: "2026-10-26", days: 5, workers: [], children: [], breaks: [] }).work).toEqual([]);
  });

  it("children are covered by school only if every one of them is at school for the whole time", () => {
    const u = usualHours({ timeZone: TZ, from: "2026-10-27", days: 1, workers: [], children: kids, breaks: [] });
    const lunch = { start: at("2026-10-27T12:00"), end: at("2026-10-27T13:30") };
    expect(allAtSchool([{ id: "mia" }], u.school, lunch)).toBe(true);
    expect(allAtSchool([{ id: "mia" }], u.school, { start: at("2026-10-27T15:00"), end: at("2026-10-27T16:00") })).toBe(false);
    // A toddler is never assumed to be anywhere.
    expect(allAtSchool(kids, u.school, lunch)).toBe(false);
  });
});
