import { describe, expect, it } from "vitest";
import { freeTimesFor } from "@/server/queries/free-time";
import { newWorld, timed } from "./harness";

const NOW = new Date("2030-10-07T07:00:00Z"); // Monday 08:00 in London

describe("when are we both free", () => {
  it("avoids both adults' commitments, reveals nothing private, and notes a heavy week", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddEvent", { title: "Therapy", visibility: "private", span: timed("2030-10-07", "18:00", "21:00"), adultIds: [w.alex.accountId] });
    const r = await freeTimesFor(w.db, w.sam, "us", 120, NOW, 3);
    expect(r.slots.length).toBeGreaterThan(0);
    for (const s of r.slots) expect(s.end <= Date.parse("2030-10-07T17:00:00Z") || s.start >= Date.parse("2030-10-07T20:00:00Z")).toBe(true);
    expect(JSON.stringify(r)).not.toContain("Therapy");
    expect(r.lighterWeek).toBe(false);

    await w.run(w.sam, "SaveCheckin", { weekKey: "2030-10-07", energy: 1 });
    expect((await freeTimesFor(w.db, w.sam, "us", 120, NOW, 3)).lighterWeek).toBe(true);
    // Sam's check-in never changes what Alex is shown.
    expect((await freeTimesFor(w.db, w.alex, "us", 120, NOW, 3)).lighterWeek).toBe(false);
  });
});
