import { describe, expect, it } from "vitest";
import { freeTimesFor } from "@/server/queries/free-time";
import { picksFor } from "@/server/queries/picks";
import { localToInstantCompatible } from "@/domain/time";
import { newWorld, timed } from "./harness";

/**
 * Review (27 Oct 2026): suggestions ignored school by default, offering a
 * cinema trip at 11:00 on a Tuesday for a 5 to 7 year old. Every suggestion
 * surface goes through the same free-time search, so these check that search
 * and the picks built on it.
 */

const TZ = "Europe/London";
const NOW = new Date("2026-10-26T07:00:00Z"); // Monday 07:00 in London (GMT)
const local = (ms: number) => {
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
  return { weekday: !["Sat", "Sun"].includes(day), time };
};

describe("suggestions keep school and working hours clear", () => {
  it("family time never lands in the school day or the working day", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    const r = await freeTimesFor(w.db, w.alex, "family", 180, NOW, 14);
    expect(r.slots.length).toBeGreaterThan(0);
    // On a weekday: over before school starts, or after the working day ends.
    const clear = (s: { start: number; end: number }) => !local(s.start).weekday || local(s.end).time <= "08:30" || local(s.start).time >= "17:30";
    for (const s of r.slots) expect(clear(s), local(s.start).time).toBe(true);
    const picks = await picksFor(w.db, w.alex, "family", NOW, { days: 14 });
    for (const p of picks.picks) if (p.slot) expect(clear(p.slot), `${p.activity.title} at ${local(p.slot.start).time}`).toBe(true);
  });

  it("a school holiday frees the school day, but not the adults' working day", async () => {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    await w.run(w.alex, "CreateHoliday", { name: "Half term", startDate: "2026-10-26", endDate: "2026-10-30", dailyStart: "08:30", dailyEnd: "17:30", includeWeekends: false, childIds: [childId] });
    // Alex has said their own week: Mondays to Wednesdays only.
    await w.run(w.alex, "AddEvent", { title: "Work", visibility: "busy_only", span: timed("2026-10-26", "09:00", "17:00"), adultIds: [w.alex.accountId], rule: { freq: "WEEKLY", byDay: ["MO", "TU", "WE"] } });
    const r = await freeTimesFor(w.db, w.alex, "me", 120, NOW, 5);
    // Thursday of half term is free for Alex in the daytime; Monday to Wednesday are not.
    const day = (s: { start: number }) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(new Date(s.start));
    const daytime = r.slots.filter((s) => local(s.start).time >= "09:00" && local(s.start).time < "17:00");
    expect(daytime.every((s) => ["Thu", "Fri", "Sat", "Sun"].includes(day(s)))).toBe(true);
  });

  it("Me time on a working day waits until after work, and the children at school need nobody", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "8-11" });
    const r = await freeTimesFor(w.db, w.alex, "me", 60, NOW, 5);
    for (const s of r.slots) {
      if (local(s.start).weekday) expect(local(s.end).time <= "09:00" || local(s.start).time >= "17:30", local(s.start).time).toBe(true);
    }
    // A long lunch is the one idea taken out of the working day, on working days only.
    const lunch = await freeTimesFor(w.db, w.alex, "us", 90, NOW, 7, ["12:00", "13:00"], { duringWork: true });
    expect(lunch.slots.length).toBeGreaterThan(0);
    expect(lunch.slots.every((s) => local(s.start).weekday)).toBe(true);
    expect(lunch.slots.every((s) => s.care === "arranged")).toBe(true);
    expect(localToInstantCompatible("2026-10-27T12:00", TZ)).toBeGreaterThan(NOW.getTime());
  });
});
