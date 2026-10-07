import { describe, expect, it } from "vitest";
import { newWorld, timed } from "./harness";

const NOW = new Date("2030-10-01T09:00:00Z");
const allDay = (date: string) => ({ allDay: true, startDate: date, endDate: date });

describe("important dates (spec 8.2)", () => {
  it("are a private heads-up, only for an adult who asked, until a plan they know of exists", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddEvent", { title: "Sam's birthday", span: allDay("2026-10-10"), adultIds: [], rule: { freq: "YEARLY" } });
    await w.run(w.alex, "AddEvent", { title: "Gift ideas deadline", visibility: "private", span: allDay("2026-10-05"), adultIds: [], rule: { freq: "YEARLY" } });
    await w.run(w.alex, "AddEvent", { title: "Dentist", span: allDay("2030-10-04"), adultIds: [] });

    const items = async (who: typeof w.alex) => (await w.week(who, "2030-09-30", NOW)).attention.filter((a) => a.action === "date-ahead").map((a) => a.text);
    const hints = (who: typeof w.alex, on: boolean) => w.run(who, "UpdateReachSettings", { pushEnabled: true, weeklyEmail: true, quietStart: "21:00", quietEnd: "07:00", dateHints: on });

    // Off by default: nobody is nudged, least of all both at once.
    expect(await items(w.alex)).toEqual([]);
    expect(await items(w.sam)).toEqual([]);

    await hints(w.alex, true);
    expect(await items(w.alex)).toEqual(["“Gift ideas deadline” is in 4 days. Only you get this reminder.", "“Sam's birthday” is in 9 days. Only you get this reminder."]);
    expect(await items(w.sam)).toEqual([]);

    await hints(w.sam, true);
    expect(await items(w.sam)).toEqual(["“Sam's birthday” is in 9 days. Only you get this reminder."]);

    // Sam's private draft that day tells Alex nothing.
    await w.run(w.sam, "CreateMoment", { kind: "us", title: "Surprise", span: timed("2030-10-10", "19:00", "21:00"), participantIds: [w.alex.accountId, w.sam.accountId] });
    expect(await items(w.alex)).toContain("“Sam's birthday” is in 9 days. Only you get this reminder.");
    expect(await items(w.sam)).toEqual([]);

    const d = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Dinner", span: timed("2030-10-10", "19:00", "21:00"), participantIds: [w.alex.accountId, w.sam.accountId] });
    await w.run(w.alex, "ShareMoment", { momentId: d.momentId, version: d.version });
    expect(await items(w.alex)).toEqual(["“Gift ideas deadline” is in 4 days. Only you get this reminder."]);
  });
});

describe("bank holidays (spec 8.4)", () => {
  it("marks them on the week without making anyone free", async () => {
    const w = await newWorld();
    const week = await w.week(w.alex, "2026-12-21", NOW);
    expect(week.markers).toEqual({ "2026-12-25": "Christmas Day" });
    expect((await w.week(w.alex, "2026-12-28", NOW)).markers["2026-12-28"]).toBe("Boxing Day (substitute day)");
  });
});
