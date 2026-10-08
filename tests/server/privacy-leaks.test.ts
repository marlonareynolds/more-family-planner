import { describe, expect, it } from "vitest";
import { exportHousehold } from "@/server/queries/exports";
import { newWorld, timed, type World } from "./harness";

/**
 * Quality release, priority 1: a surprise's or Me time's title, notes and
 * planned limit never reach the other adult, through any output. Each case
 * reproduces a leak found in the best-in-class review (A1–A3) at 7efca29.
 * Time, care and real money stay shared (the privacy split in domain/moments).
 */

const NOW = new Date("2026-10-07T09:00:00Z");
const base = (over: Record<string, unknown>) => ({ notes: "", location: "", activityKey: null, childIds: [], needsCare: false, budgetMinor: null, travelBeforeMinutes: 0, travelAfterMinutes: 0, surprise: false, ...over });

async function surprise(w: World) {
  const { momentId } = await w.run(
    w.alex,
    "CreateMoment",
    base({ kind: "us", title: "SECRET Paris weekend", notes: "Eurostar 07:01", location: "Gare du Nord", span: timed("2026-10-17", "19:00", "22:00"), participantIds: [w.alex.accountId, w.sam.accountId], surprise: true, budgetMinor: 45000 }),
  );
  const m0 = (await w.week(w.alex, "2026-10-12", NOW)).moments.find((m) => m.id === momentId)!;
  await w.run(w.alex, "ShareMoment", { momentId, version: m0.version });
  const mS = (await w.week(w.sam, "2026-10-12", NOW)).moments.find((m) => m.id === momentId)!;
  await w.run(w.sam, "RespondToMoment", { momentId, materialVersion: mS.materialVersion, decision: "accepted" });
  await w.run(w.alex, "AddExpense", { label: "SECRET Paris weekend", estimateMinor: 45000, sourceType: "moment", sourceId: momentId });
  return momentId as string;
}

async function meTime(w: World) {
  const { momentId } = await w.run(
    w.alex,
    "CreateMoment",
    base({ kind: "me", title: "PRIVATE therapy", notes: "secret notes", span: timed("2026-10-15", "10:00", "11:00"), participantIds: [w.alex.accountId], budgetMinor: 8000 }),
  );
  const m0 = (await w.week(w.alex, "2026-10-12", NOW)).moments.find((m) => m.id === momentId)!;
  await w.run(w.alex, "ShareMoment", { momentId, version: m0.version });
  await w.run(w.alex, "AddExpense", { label: "PRIVATE therapy", estimateMinor: 8000, sourceType: "moment", sourceId: momentId });
  return momentId as string;
}

const leaks = (v: unknown) => /SECRET|PRIVATE|Eurostar|Gare du Nord|secret notes/.test(JSON.stringify(v));

describe("surprise privacy across every output", () => {
  it("A1: a clash with an accepted surprise shows as busy, never its title", async () => {
    const w = await newWorld();
    await surprise(w);
    await w.run(w.sam, "CreateMoment", base({ kind: "me", title: "Sam gym", span: timed("2026-10-17", "20:00", "21:00"), participantIds: [w.sam.accountId] }));
    const gym = (await w.week(w.sam, "2026-10-12", NOW)).moments.find((m) => m.title === "Sam gym")!;
    expect(gym.conflicts).toHaveLength(1);
    expect(gym.conflicts[0].title).toBeUndefined();
    expect(leaks(gym.conflicts)).toBe(false);
  });

  it("A1: the organiser still sees their own surprise named in a clash", async () => {
    const w = await newWorld();
    await surprise(w);
    await w.run(w.alex, "CreateMoment", base({ kind: "me", title: "Alex run", span: timed("2026-10-17", "20:00", "21:00"), participantIds: [w.alex.accountId] }));
    const run = (await w.week(w.alex, "2026-10-12", NOW)).moments.find((m) => m.title === "Alex run")!;
    expect(run.conflicts[0].title).toBe("SECRET Paris weekend");
  });

  it("A1: a refused change says busy, not the surprise's title", async () => {
    const w = await newWorld();
    await surprise(w);
    // Sam accepting a plan at the surprise's time is refused; the refusal must not name it.
    const { momentId } = await w.run(w.alex, "CreateMoment", base({ kind: "family", title: "Football", span: timed("2026-10-17", "20:00", "21:00"), participantIds: [w.alex.accountId, w.sam.accountId] }));
    const m0 = (await w.week(w.alex, "2026-10-12", NOW)).moments.find((m) => m.id === momentId)!;
    await w.run(w.alex, "ShareMoment", { momentId, version: m0.version }).catch(() => undefined);
    const mS = (await w.week(w.sam, "2026-10-12", NOW)).moments.find((m) => m.id === momentId)!;
    const err = await w.run(w.sam, "RespondToMoment", { momentId, materialVersion: mS.materialVersion, decision: "accepted" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    expect(leaks(err)).toBe(false);
    expect(leaks((err as { details?: unknown }).details)).toBe(false);
  });

  it("A2: the household export labels the surprise's cost plainly", async () => {
    const w = await newWorld();
    await surprise(w);
    const ex = await exportHousehold(w.db, w.sam);
    expect(ex.expenses.map((e) => e.label)).toEqual(["Surprise plan"]);
    expect(ex.expenses[0].estimateMinor).toBe(45000);
    expect(leaks(ex)).toBe(false);
  });

  it("A3: the planned spending limit is private; the week view and export hide it", async () => {
    const w = await newWorld();
    const id = await surprise(w);
    const mS = (await w.week(w.sam, "2026-10-12", NOW)).moments.find((m) => m.id === id)!;
    expect(mS.budgetMinor).toBeNull();
    expect(mS.title).toBe("A surprise from Alex");
    const ex = await exportHousehold(w.db, w.sam);
    expect(ex.moments.find((m) => m.title === "Surprise")?.budgetMinor ?? null).toBeNull();
    const mA = (await w.week(w.alex, "2026-10-12", NOW)).moments.find((m) => m.id === id)!;
    expect(mA.budgetMinor).toBe(45000);
  });

  it("whole week view and export for the partner carry no detail of the surprise", async () => {
    const w = await newWorld();
    await surprise(w);
    expect(leaks(await w.week(w.sam, "2026-10-12", NOW))).toBe(false);
    expect(leaks(await exportHousehold(w.db, w.sam))).toBe(false);
  });
});

describe("Me time privacy across every output", () => {
  it("export and week view label Me time's cost plainly and hide its limit", async () => {
    const w = await newWorld();
    const id = await meTime(w);
    const wk = await w.week(w.sam, "2026-10-12", NOW);
    const m = wk.moments.find((x) => x.id === id)!;
    expect(m.budgetMinor).toBeNull();
    expect(m.notes).toBe("");
    expect(wk.expenses.map((e) => e.label)).toEqual(["Time for themselves"]);
    const ex = await exportHousehold(w.db, w.sam);
    expect(ex.expenses.map((e) => e.label)).toEqual(["Time for themselves"]);
    expect(leaks(wk)).toBe(false);
    expect(leaks(ex)).toBe(false);
  });

  it("shared information stays shared: the time is busy and the real cost counts", async () => {
    const w = await newWorld();
    const id = await meTime(w);
    const wk = await w.week(w.sam, "2026-10-12", NOW);
    const m = wk.moments.find((x) => x.id === id)!;
    expect(m.start).toBe(new Date("2026-10-15T09:00:00Z").getTime());
    expect(wk.money.estimateMinor).toBe(8000);
  });
});
