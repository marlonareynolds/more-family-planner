import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notifications } from "@/db/schema";
import { processOutbox } from "@/server/outbox";
import { freeTimesFor } from "@/server/queries/free-time";
import { newWorld, timed } from "./harness";

const WEEK = "2030-10-07"; // Monday
const NOW = new Date("2030-10-01T09:00:00Z");
const trip = (over: Record<string, unknown> = {}) => ({ kind: "work", title: "Conference", destination: "Lisbon", startDate: "2030-10-08", startTime: "08:00", endDate: "2030-10-10", endTime: "20:00", ...over });

describe("trips and time away", () => {
  it("makes the traveller away, and turns the other parent's evening plans into care needs", async () => {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    await w.run(w.sam, "AddEvent", { title: "Five-a-side", span: timed("2030-10-09", "19:00", "21:00"), adultIds: [w.sam.accountId] });
    await w.run(w.sam, "AddEvent", { title: "Work meeting", span: timed("2030-10-09", "10:00", "12:00"), adultIds: [w.sam.accountId] });
    await w.run(w.sam, "AddEvent", { title: "Swimming with Mia", span: timed("2030-10-08", "17:00", "18:00"), adultIds: [w.sam.accountId], childIds: [childId] });
    await w.run(w.alex, "AddTrip", trip({ travellerIds: [w.alex.accountId] }));

    const week = await w.week(w.sam, WEEK, NOW);
    expect(week.trips.map((t) => t.title)).toEqual(["Conference"]);
    const needs = week.care.flatMap((d) => d.groups.map((g) => ({ date: d.date, reason: g.reason, gaps: g.gaps.length })));
    // Only the evening football: the meeting is in school hours, swimming includes Mia.
    expect(needs).toEqual([{ date: "2030-10-09", reason: "Alex away", gaps: 1 }]);
    const gap = week.care[0].groups[0].gaps[0];
    expect([new Date(gap.start).toISOString(), new Date(gap.end).toISOString()]).toEqual(["2030-10-09T18:00:00.000Z", "2030-10-09T19:30:00.000Z"]);
    expect(week.attention.some((a) => a.action === "care-gap")).toBe(true);

    // Alex is away, so no time together is offered while the trip lasts.
    const free = await freeTimesFor(w.db, w.alex, "us", 120, new Date("2030-10-07T06:00:00Z"), 7);
    const [away, back] = [Date.parse("2030-10-08T07:00:00Z"), Date.parse("2030-10-10T19:00:00Z")];
    expect(free.slots.some((s) => s.start < back && s.end > away)).toBe(false);
    expect(free.slots.some((s) => s.date === "2030-10-10")).toBe(true); // back in time for the evening

    await processOutbox(w.db);
    const told = await w.db.select().from(notifications).where(eq(notifications.accountId, w.sam.accountId));
    expect(told.map((n) => n.text)).toContain("Alex added time away: Conference.");
  });

  it("needs care for the whole time when both adults go, and none for a family holiday", async () => {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    const both = [w.alex.accountId, w.sam.accountId];
    const { tripId } = await w.run(w.alex, "AddTrip", trip({ kind: "personal", title: "Wedding", startDate: "2030-10-11", startTime: "14:00", endDate: "2030-10-12", endTime: "18:00", travellerIds: both }));
    let week = await w.week(w.alex, WEEK, NOW);
    expect(week.care.map((d) => d.date)).toEqual(["2030-10-11", "2030-10-12"]);
    expect(week.care.every((d) => d.groups.every((g) => g.reason === "Alex and Sam away" && g.state === "unresolved"))).toBe(true);

    // Grandma has Mia for the whole trip: covered.
    await w.run(w.alex, "ArrangeCare", { kind: "external", providerName: "Grandma", confirmed: true, childIds: [childId], span: timed("2030-10-11", "13:00", "19:00", "2030-10-12") });
    week = await w.week(w.alex, WEEK, NOW);
    expect(week.care.every((d) => d.groups.every((g) => g.state === "covered"))).toBe(true);

    const t = week.trips.find((x) => x.id === tripId)!;
    await w.run(w.alex, "CancelTrip", { tripId, version: t.version });
    expect((await w.week(w.alex, WEEK, NOW)).trips).toEqual([]);

    await w.run(w.alex, "AddTrip", trip({ kind: "family", title: "Cornwall", startDate: "2030-10-26", endDate: "2030-11-01", travellerIds: both, childIds: [childId] }));
    const now = new Date("2030-10-14T09:00:00Z");
    const later = await w.week(w.alex, "2030-10-21", now);
    expect(later.nextFamilyTrip?.title).toBe("Cornwall");
    const holidayWeek = await w.week(w.alex, "2030-10-28", now);
    expect(holidayWeek.care).toEqual([]);
  });

  it("checks the dates and the people", async () => {
    const w = await newWorld();
    await expect(w.run(w.alex, "AddTrip", trip({ endDate: "2030-10-07", travellerIds: [w.alex.accountId] }))).rejects.toThrow(/end after/);
    await expect(w.run(w.alex, "AddTrip", trip({ travellerIds: [] }))).rejects.toThrow(/who is going/i);
  });
});
