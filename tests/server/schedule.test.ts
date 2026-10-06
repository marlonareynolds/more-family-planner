import { describe, expect, it } from "vitest";
import { expectCode, newWorld, timed } from "./harness";

describe("our week", () => {
  it("AT-19: occurrence, this-and-future and whole-series edits", async () => {
    const w = await newWorld();
    const { eventId } = await w.run(w.alex, "AddEvent", {
      title: "Swimming", span: timed("2030-10-07", "17:00", "18:00"), adultIds: [w.alex.accountId], rule: { freq: "WEEKLY", byDay: ["MO", "WE"] },
    });
    let wk = await w.week(w.alex, "2030-10-14");
    expect(wk.events.map((e) => e.recurrenceId)).toEqual(["2030-10-14T17:00", "2030-10-16T17:00"]);

    // Move one occurrence into the next week.
    await w.run(w.alex, "UpdateEvent", { eventId, version: 1, scope: "occurrence", recurrenceId: "2030-10-16T17:00", fields: { title: "Swimming", span: timed("2030-10-21", "08:00", "09:00"), adultIds: [w.alex.accountId] } });
    wk = await w.week(w.alex, "2030-10-14");
    expect(wk.events.map((e) => e.recurrenceId)).toEqual(["2030-10-14T17:00"]);
    wk = await w.week(w.alex, "2030-10-21");
    expect(wk.events.map((e) => e.recurrenceId)).toEqual(["2030-10-16T17:00", "2030-10-21T17:00", "2030-10-23T17:00"]);

    // This and future from 28 Oct moves to 18:00; history stays at 17:00.
    await w.run(w.alex, "UpdateEvent", { eventId, version: 2, scope: "future", recurrenceId: "2030-10-28T17:00", fields: { title: "Swimming", span: timed("2030-10-28", "18:00", "19:00"), adultIds: [w.alex.accountId], rule: { freq: "WEEKLY", byDay: ["MO", "WE"] } } });
    wk = await w.week(w.alex, "2030-10-28");
    expect(wk.events.map((e) => e.localStart.slice(11))).toEqual(["18:00", "18:00"]);
    wk = await w.week(w.alex, "2030-10-21");
    expect(wk.events).toHaveLength(3);

    await expectCode(w.run(w.alex, "UpdateEvent", { eventId, version: 1, scope: "series", fields: { title: "x", span: timed("2030-10-07", "17:00", "18:00") } }), "STALE_VERSION");
  });

  it("AT-10: a time inside the clock-change gap is refused", async () => {
    const w = await newWorld();
    await expectCode(w.run(w.alex, "AddEvent", { title: "x", span: timed("2030-03-31", "01:30", "02:30") }), "DST_GAP");
  });

  it("AT-11 and holiday edits through an impact preview", async () => {
    const w = await newWorld();
    for (const n of ["A", "B"]) await w.run(w.alex, "AddChild", { preferredName: n, ageBand: "8-11" });
    const kids = (await w.week(w.alex, "2030-10-21")).children.map((k) => k.id);
    const { holidayId } = await w.run(w.alex, "CreateHoliday", { name: "Half term", startDate: "2030-10-21", endDate: "2030-10-25", dailyStart: "08:30", dailyEnd: "17:30", childIds: kids });
    await w.run(w.alex, "ArrangeCare", { kind: "external", providerName: "Nana", confirmed: true, childIds: kids, span: timed("2030-10-25", "08:30", "17:30") });
    const wk = await w.week(w.alex, "2030-10-21");
    expect(wk.care).toHaveLength(5);
    expect(wk.care[4].groups[0].state).toBe("covered");
    expect(wk.care[0].groups[0].childIds).toHaveLength(2);

    const shorter = { holidayId, version: 1, name: "Half term", startDate: "2030-10-21", endDate: "2030-10-24", dailyStart: "08:30", dailyEnd: "17:30", childIds: kids };
    const preview = await w.run(w.alex, "UpdateHoliday", { ...shorter, previewOnly: true });
    expect(preview.impact).toMatchObject({ removed: 2, added: 0, removedWithArrangements: 2 });
    await expectCode(w.run(w.alex, "UpdateHoliday", shorter), "CONFLICT");
    await w.run(w.alex, "UpdateHoliday", { ...shorter, acknowledgeRemovedCare: true });
    expect((await w.week(w.alex, "2030-10-21")).care).toHaveLength(4);
  });
});
