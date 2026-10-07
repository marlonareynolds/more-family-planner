import { describe, expect, it } from "vitest";
import { eventExceptions } from "@/db/schema";
import { loadEventOccurrences, loaderStats } from "@/server/queries/busy";
import { expectCode, newWorld, timed } from "./harness";

/**
 * BR-16: the week you read and the checks that guard a change agree, for
 * moved repeats, clock changes and travel time. "Read" is the conflict a
 * plan shows on the week; "write" is the clash check when a parent offers
 * to look after the children at that time.
 */
type World = Awaited<ReturnType<typeof newWorld>>;
const at = (iso: string) => new Date(iso);

async function probe(w: World, date: string, start: string, end: string, weekKey: string, now: Date) {
  const { momentId } = await w.run(w.alex, "CreateMoment", { kind: "me", title: `Probe ${date} ${start}`, span: timed(date, start, end), participantIds: [w.alex.accountId] });
  const shown = (await w.week(w.alex, weekKey, now)).moments.find((m) => m.id === momentId)!;
  const { childId } = await w.run(w.alex, "AddChild", { preferredName: `Kid${Math.random().toString(36).slice(2, 6)}`, ageBand: "5-7" });
  let write: "free" | "busy";
  try {
    await w.run(w.alex, "ArrangeCare", { kind: "parent", responsibleAccountId: w.alex.accountId, childIds: [childId], span: timed(date, start, end) });
    write = "free";
  } catch (e) {
    await expectCode(Promise.reject(e), "CONFLICT");
    write = "busy";
  }
  await w.run(w.alex, "CancelMoment", { momentId, version: (await w.week(w.alex, weekKey, now)).moments.find((m) => m.id === momentId)!.version }).catch(() => undefined);
  return { read: shown.conflicts.length ? "busy" : "free", write };
}

describe("BR-16 read and write paths agree", () => {
  it("a repeat moved into another week is busy where it went and free where it was", async () => {
    const w = await newWorld();
    const { eventId } = await w.run(w.alex, "AddEvent", { title: "Choir", span: timed("2030-10-07", "18:00", "19:00"), adultIds: [w.alex.accountId], rule: { freq: "WEEKLY", byDay: ["MO"] } });
    await w.run(w.alex, "UpdateEvent", { eventId, version: 1, scope: "occurrence", recurrenceId: "2030-10-14T18:00", fields: { title: "Choir", span: timed("2030-10-23", "18:00", "19:00"), adultIds: [w.alex.accountId], rule: { freq: "WEEKLY", byDay: ["MO"] } } });
    const now = at("2030-10-10T12:00:00Z");
    const choir = async (weekKey: string) => (await w.week(w.alex, weekKey, now)).events.filter((e) => e.title === "Choir").map((e) => e.recurrenceId + "@" + new Date(e.start).toISOString());
    expect(await choir("2030-10-14")).toEqual([]);
    expect(await choir("2030-10-21")).toEqual(["2030-10-21T18:00@2030-10-21T17:00:00.000Z", "2030-10-14T18:00@2030-10-23T17:00:00.000Z"]);
    expect(await probe(w, "2030-10-14", "18:00", "19:00", "2030-10-14", now)).toEqual({ read: "free", write: "free" });
    expect(await probe(w, "2030-10-23", "18:00", "19:00", "2030-10-21", now)).toEqual({ read: "busy", write: "busy" });
  });

  it("a weekly 18:00 stays at 18:00 local when the clocks go back", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddEvent", { title: "Swim club", span: timed("2030-10-18", "18:00", "19:00"), adultIds: [w.alex.accountId], rule: { freq: "WEEKLY", byDay: ["FR"] } });
    const now = at("2030-10-17T12:00:00Z");
    const starts = (await w.week(w.alex, "2030-10-28", now)).events.filter((e) => e.title === "Swim club").map((e) => new Date(e.start).toISOString());
    expect(starts).toEqual(["2030-11-01T18:00:00.000Z"]); // GMT after the change
    expect(await probe(w, "2030-11-01", "18:00", "19:00", "2030-10-28", now)).toEqual({ read: "busy", write: "busy" });
    // Where it would sit if the clock change were ignored (17:00 local) is free in both.
    expect(await probe(w, "2030-11-01", "17:00", "18:00", "2030-10-28", now)).toEqual({ read: "free", write: "free" });
    // And the week before the change, still on summer time.
    expect(await probe(w, "2030-10-25", "18:00", "19:00", "2030-10-21", now)).toEqual({ read: "busy", write: "busy" });
  });

  it("travel time alone is enough to clash, in both paths", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddEvent", { title: "Dentist", span: timed("2030-10-12", "10:00", "11:00"), adultIds: [w.alex.accountId], travelBeforeMinutes: 30 });
    const now = at("2030-10-10T12:00:00Z");
    expect(await probe(w, "2030-10-12", "09:30", "10:00", "2030-10-07", now)).toEqual({ read: "busy", write: "busy" });
    expect(await probe(w, "2030-10-12", "09:00", "09:30", "2030-10-07", now)).toEqual({ read: "free", write: "free" });
    expect(await probe(w, "2030-10-12", "11:00", "11:30", "2030-10-07", now)).toEqual({ read: "free", write: "free" });
  });
});

describe("BR-18 a long series with thousands of exceptions stays bounded", () => {
  it("one week of a ten-year daily series with 3,650 exceptions reads only that week's exceptions", async () => {
    const w = await newWorld();
    const { eventId } = await w.run(w.alex, "AddEvent", { title: "School run", span: timed("2021-01-04", "08:15", "08:45"), adultIds: [w.alex.accountId], rule: { freq: "DAILY" } });
    // Every day for ten years has an exception: odd days cancelled, even days moved 15 minutes later.
    const rows = [];
    for (let i = 0; i < 3650; i++) {
      const d = new Date(Date.UTC(2021, 0, 4 + i)).toISOString().slice(0, 10);
      const recurrenceId = `${d}T08:15`;
      if (i % 2) rows.push({ eventId, recurrenceId, kind: "cancelled" as const });
      else rows.push({ eventId, recurrenceId, kind: "moved" as const, startAt: new Date(`${d}T08:00:00Z`), endAt: new Date(`${d}T08:30:00Z`) });
    }
    for (let i = 0; i < rows.length; i += 500) await w.db.insert(eventExceptions).values(rows.slice(i, i + 500));

    const horizon = { start: Date.parse("2030-10-07T00:00:00Z"), end: Date.parse("2030-10-14T00:00:00Z") };
    const t0 = performance.now();
    const occ = await loadEventOccurrences(w.db, w.householdId, horizon);
    const loadMs = performance.now() - t0;
    const exceptionsRead = loaderStats.lastExceptionsRead;
    const t1 = performance.now();
    const week = await w.week(w.alex, "2030-10-07", at("2030-10-06T12:00:00Z"));
    const weekMs = performance.now() - t1;
    const bytes = JSON.stringify(week).length;
    console.log(`BR-18: occurrences ${occ.length}, loader ${loadMs.toFixed(0)} ms, week view ${weekMs.toFixed(0)} ms, payload ${bytes} bytes, exceptions read ${exceptionsRead}`);

    // Correct: only the moved (even) days remain that week, at their moved times.
    expect(occ.every((o) => new Date(o.start).toISOString().endsWith("T08:00:00.000Z"))).toBe(true);
    expect(occ.length).toBeGreaterThanOrEqual(3);
    expect(occ.length).toBeLessThanOrEqual(4);
    // Bounded: the exceptions read are those near the week, not the whole history.
    expect(exceptionsRead).toBeLessThanOrEqual(40);
    expect(bytes).toBeLessThan(200_000);
  }, 120_000);
});
