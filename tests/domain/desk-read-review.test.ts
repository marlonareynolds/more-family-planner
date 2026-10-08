// Back-up (rule) reader misreads found in the best-in-class review, 2026-10-07,
// and Marlon's review of 2026-10-08. Expected values are what a parent would
// want; each failed on main 7efca29.
import { describe, expect, it } from "vitest";
import { readLetter } from "@/lib/desk-read";

const ctx = { today: "2026-10-07", children: [] };
const one = (t: string) => readLetter(t, ctx)[0];

describe("desk rule reader: review probes", () => {
  it("a first time with minutes borrows pm from the second", () => {
    expect(one("Disco 16 Oct 6:00-7:15pm")).toMatchObject({ startTime: "18:00", endTime: "19:15" });
    expect(one("Disco 16 Oct 4:30–5:30pm")).toMatchObject({ startTime: "16:30", endTime: "17:30" });
    expect(one("Football club 15 October, 3:30-4:30pm")).toMatchObject({ startTime: "15:30", endTime: "16:30" });
  });
  it("a price with pence doesn't stop a payment deadline being a deadline", () => {
    expect(one("Please pay £12.50 for the trip by 17 October.")).toMatchObject({ role: "deadline" });
  });
  it("two events on one line get their own titles", () => {
    const titles = readLetter("Flu vaccinations on 14 Oct and school photos on 21 Oct.", ctx).map((p) => p.title);
    expect(titles).toEqual(["Flu vaccinations", "School photos"]);
  });
  it("a payment deadline keeps its amount with it and is titled by what it pays for", () => {
    expect(one("Please pay £12.50 for the trip by 17 October.")).toMatchObject({ title: "Trip payment deadline", startDate: "2026-10-17", details: "Please pay £12.50 for the trip by 17 October." });
  });
  it("an end after midnight ends the next day", () => {
    expect(one("New Year's Eve party 31 December 8pm until 1am")).toMatchObject({ startDate: "2026-12-31", startTime: "20:00", endDate: "2027-01-01", endTime: "01:00", endStated: true });
  });
  it("says when an end time was not given", () => {
    expect(one("Harvest Assembly on 19 October at 9:15am")).toMatchObject({ startTime: "09:15", endStated: false });
    expect(one("Disco 16 Oct 6:00-7:15pm")).toMatchObject({ endStated: true });
  });
  it("marks an early finish as a pickup change", () => {
    expect(one("School will close at 1:30pm on Friday 19 December for Christmas.")).toMatchObject({ pickupChange: true });
  });
  it("keeps a weekly repeat and who it is for", () => {
    expect(one("Year 5 swimming every Tuesday from 20 October, bring a towel and goggles.")).toMatchObject({ repeat: "weekly", forWhom: "Year 5", details: "Year 5 swimming every Tuesday from 20 October, bring a towel and goggles." });
  });
  it("an early close before a break is an optional item with its time", () => {
    expect(one("School will close at 1:30pm on Friday 19 December for Christmas.")).toMatchObject({ role: "optional", startTime: "13:30" });
  });
});
