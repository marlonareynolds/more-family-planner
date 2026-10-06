import { describe, expect, it } from "vitest";
import { newWorld, timed } from "./harness";

const NOW = new Date("2030-10-01T09:00:00Z");
const allDay = (date: string) => ({ allDay: true, startDate: date, endDate: date });

describe("important dates (spec 8.2)", () => {
  it("gives both adults a heads-up two weeks ahead, until something is planned", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddEvent", { title: "Sam's birthday", span: allDay("2026-10-10"), adultIds: [], rule: { freq: "YEARLY" } });
    await w.run(w.alex, "AddEvent", { title: "Gift ideas deadline", visibility: "private", span: allDay("2026-10-05"), adultIds: [], rule: { freq: "YEARLY" } });
    await w.run(w.alex, "AddEvent", { title: "Dentist", span: allDay("2030-10-04"), adultIds: [] });

    const items = async (who: typeof w.alex) => (await w.week(who, "2030-09-30", NOW)).attention.filter((a) => a.action === "date-ahead").map((a) => a.text);
    expect(await items(w.alex)).toEqual(["“Gift ideas deadline” is in 4 days. Want to plan something?", "“Sam's birthday” is in 9 days. Want to plan something?"]);
    expect(await items(w.sam)).toEqual(["“Sam's birthday” is in 9 days. Want to plan something?"]);

    await w.run(w.alex, "CreateMoment", { kind: "us", title: "Dinner", span: timed("2030-10-10", "19:00", "21:00"), participantIds: [w.alex.accountId, w.sam.accountId] });
    expect(await items(w.sam)).toEqual([]);
  });
});
