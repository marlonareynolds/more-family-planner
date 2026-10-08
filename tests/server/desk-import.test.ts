import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { events, jobs, trips } from "@/db/schema";
import { checkDesk, deskKeys, type DeskCheckInput } from "@/server/desk";
import { dayTitleKey, diaryTimes, normTitle } from "@/lib/desk-keys";
import { jobsFor } from "@/server/queries/jobs";
import { newWorld, type World } from "./harness";

/**
 * Quality release, priority 4: the Desk remembers what it put in the diary,
 * on the server. A letter read twice, or by both parents, never doubles the
 * diary; a changed notice offers to update; siblings and second sessions stay
 * separate; and what the letter said (place, kit, payment, arrival time,
 * repeats) survives into the entry. Each case failed before this release:
 * the old Desk added straight from the phone with no memory at all.
 */

const NOW = new Date("2026-10-07T09:00:00Z");

const card = (over: Record<string, unknown> = {}) => ({
  ref: "c1",
  kind: "event",
  title: "Year 4 trip to the Science Museum",
  startDate: "2026-11-12",
  endDate: "2026-11-12",
  allDay: false,
  startTime: "09:00",
  endTime: "15:15",
  location: "Science Museum, London",
  details: "Packed lunch, waterproof coat",
  childIds: [] as string[],
  justMe: false,
  action: "add",
  ...over,
});

async function statusOf(w: World, viewer: World["alex"], c: ReturnType<typeof card>) {
  const keys = await deskKeys(w.householdId, c as never, c.justMe ? viewer.accountId : null);
  const t = diaryTimes(c as never);
  const item: DeskCheckInput = { ref: c.ref, kind: c.kind as never, startDate: c.startDate, startTime: t.startTime, endDate: t.endDate, endTime: t.endTime, ...keys, dayTitleKey: await dayTitleKey(w.householdId, c.startDate, c.title) };
  return (await checkDesk(w.db, viewer, w.householdId, [item]))[0];
}

const imp = (w: World, who: World["alex"], items: unknown[]) => w.run(who, "ImportDeskItems", { items });
const liveEvents = (w: World) => w.db.select().from(events).where(and(eq(events.householdId, w.householdId), isNull(events.cancelledAt)));

describe("Household Desk duplicates and follow-through", () => {
  it("the same letter read twice is added once", async () => {
    const w = await newWorld();
    const first = await imp(w, w.alex, [card()]);
    expect(first.results[0].outcome).toBe("added");
    expect(await statusOf(w, w.alex, card())).toMatchObject({ status: "added", by: "you" });
    const again = await imp(w, w.alex, [card()]);
    expect(again.results[0].outcome).toBe("already");
    expect(await liveEvents(w)).toHaveLength(1);
  });

  it("both parents importing the same letter: the second is told it's there", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [card()]);
    expect(await statusOf(w, w.sam, card())).toMatchObject({ status: "added", by: "Alex" });
    const sam = await imp(w, w.sam, [card()]);
    expect(sam.results[0].outcome).toBe("already");
    expect(await liveEvents(w)).toHaveLength(1);
  });

  it("two adults importing at the same moment still add it once", async () => {
    const w = await newWorld();
    const [a, b] = await Promise.all([imp(w, w.alex, [card()]), imp(w, w.sam, [card()])]);
    expect([a.results[0].outcome, b.results[0].outcome].sort()).toEqual(["added", "already"]);
    expect(await liveEvents(w)).toHaveLength(1);
  });

  it("a changed notice offers to update, and updating changes the one entry", async () => {
    const w = await newWorld();
    const { results } = await imp(w, w.alex, [card()]);
    const changed = card({ endTime: "16:00", details: "Packed lunch, waterproof coat, £5 for the shop" });
    const s = await statusOf(w, w.sam, changed);
    expect(s).toMatchObject({ status: "changed", current: { targetId: results[0].targetId, startTime: "09:00", endTime: "15:15" } });
    const up = await imp(w, w.sam, [{ ...changed, action: "update", targetId: results[0].targetId, targetVersion: (s as { current: { version: number } }).current.version }]);
    expect(up.results[0].outcome).toBe("updated");
    const rows = await liveEvents(w);
    expect(rows).toHaveLength(1);
    expect(rows[0].notes).toContain("£5 for the shop");
    expect(rows[0].durationMinutes).toBe(7 * 60);
    expect(await statusOf(w, w.alex, changed)).toMatchObject({ status: "added" });
  });

  it("a new start time on the same day is offered as a possible change, and can update the one entry", async () => {
    const w = await newWorld();
    const { results } = await imp(w, w.alex, [card()]);
    const later = card({ startTime: "10:00" });
    const s = await statusOf(w, w.sam, later);
    expect(s).toMatchObject({ status: "possible", sameDay: true, candidates: [{ targetId: results[0].targetId, startTime: "09:00" }] });
    await imp(w, w.sam, [{ ...later, action: "update", targetId: results[0].targetId, targetVersion: (s as { candidates: { version: number }[] }).candidates[0].version }]);
    const rows = await liveEvents(w);
    expect(rows).toHaveLength(1);
    expect(rows[0].localStart).toBe("2026-11-12T10:00");
    expect(await statusOf(w, w.alex, later)).toMatchObject({ status: "added" });
  });

  it("a notice moved to another date is offered as a move", async () => {
    const w = await newWorld();
    const { results } = await imp(w, w.alex, [card()]);
    const moved = card({ startDate: "2026-11-19", endDate: "2026-11-19" });
    const s = await statusOf(w, w.alex, moved);
    expect(s).toMatchObject({ status: "possible", sameDay: false, candidates: [{ startDate: "2026-11-12", targetId: results[0].targetId }] });
    await imp(w, w.alex, [{ ...moved, action: "update", targetId: results[0].targetId, targetVersion: (s as { candidates: { version: number }[] }).candidates[0].version }]);
    const rows = await liveEvents(w);
    expect(rows).toHaveLength(1);
    expect(rows[0].localStart.slice(0, 10)).toBe("2026-11-19");
  });

  it("siblings and second sessions are not duplicates", async () => {
    const w = await newWorld();
    const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId;
    const leo = (await w.run(w.alex, "AddChild", { preferredName: "Leo", ageBand: "8-11" })).childId;
    await imp(w, w.alex, [card({ title: "School photos", childIds: [mia] })]);
    expect(await statusOf(w, w.alex, card({ ref: "c2", title: "School photos", childIds: [leo] }))).toMatchObject({ status: "new" });
    const r = await imp(w, w.alex, [
      card({ ref: "c2", title: "School photos", childIds: [leo] }),
      card({ ref: "c3", title: "School photos", childIds: [mia], startTime: "13:00", endTime: "14:00" }),
    ]);
    expect(r.results.map((x: { outcome: string }) => x.outcome)).toEqual(["added", "added"]);
    expect(await liveEvents(w)).toHaveLength(3);
  });

  it("a similar title alone is not a duplicate, but a hand-made entry that day is pointed out", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddEvent", { title: "Science museum trip", notes: "", location: "", visibility: "shared", span: { allDay: true, startDate: "2026-11-12", endDate: "2026-11-12" }, adultIds: [w.alex.accountId], childIds: [], rule: null });
    expect(await statusOf(w, w.sam, card({ title: "Science Museum trip" }))).toMatchObject({ status: "similar", title: "Science museum trip" });
    expect(await statusOf(w, w.sam, card({ title: "Science Museum trip", startDate: "2026-11-13", endDate: "2026-11-13" }))).toMatchObject({ status: "new" });
  });

  it("a partial import lands whole or not at all", async () => {
    const w = await newWorld();
    // The second card's school break has no children, which CreateHoliday refuses.
    await expect(imp(w, w.alex, [card(), card({ ref: "c2", kind: "holiday", title: "Half term", startDate: "2026-10-26", endDate: "2026-10-30", allDay: true, startTime: null, endTime: null })])).rejects.toThrow();
    expect(await liveEvents(w)).toHaveLength(0);
    expect(await statusOf(w, w.alex, card())).toMatchObject({ status: "new" });
  });

  it("'just for me' cards are invisible to the other adult's duplicate check", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [card({ title: "Surprise party planning", justMe: true })]);
    expect(await statusOf(w, w.sam, card({ title: "Surprise party planning" }))).toMatchObject({ status: "new" });
    expect(await statusOf(w, w.alex, card({ title: "Surprise party planning", justMe: true }))).toMatchObject({ status: "added" });
  });

  it("keeps place, kit, arrival time and repeats from the letter", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [
      card({ arriveBy: "08:30" }),
      card({ ref: "c2", title: "Swimming club", startDate: "2026-10-13", endDate: "2026-10-13", startTime: "16:00", endTime: "17:00", location: "Leisure centre", details: "Goggles", repeat: "weekly", repeatUntil: "2026-12-15" }),
    ]);
    const rows = await liveEvents(w);
    const trip = rows.find((r) => r.title.startsWith("Year 4"))!;
    expect(trip.location).toBe("Science Museum, London");
    expect(trip.localStart).toBe("2026-11-12T08:30");
    expect(trip.notes).toContain("Packed lunch, waterproof coat");
    expect(trip.notes).toContain("Arrive by 08:30; it starts at 09:00.");
    const swim = rows.find((r) => r.title === "Swimming club")!;
    expect(swim.rule).toMatchObject({ freq: "WEEKLY", interval: 1, byDay: ["TU"], count: 10 });
    expect(swim.notes).toBe("From the letter:\n• Goggles");
  });

  it("a payment deadline becomes a job due by noon, linked to its trip, and asks the partner to pay", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [
      card(),
      { ...card({ ref: "c2", title: "Trip payment deadline", startDate: "2026-10-20", endDate: "2026-10-20", startTime: "12:00", endTime: null, details: "£12.50 on ParentPay" }), kind: "job", owner: "partner", forRef: "c1" },
    ]);
    const [job] = await w.db.select().from(jobs).where(eq(jobs.householdId, w.householdId));
    expect(job).toMatchObject({ dueTime: "12:00", cadence: "once", startsOn: "2026-10-20", ownerId: null, proposedOwnerId: w.sam.accountId, forType: "event" });
    const view = (await jobsFor(w.db, w.sam, NOW)).jobs[0];
    expect(view.forTitle).toBe("Year 4 trip to the Science Museum");
    expect(view.notes).toContain("ParentPay");
    // Overdue after noon on the day, not before.
    expect((await jobsFor(w.db, w.sam, new Date("2026-10-20T10:30:00Z"))).jobs[0].status).not.toBe("overdue");
    expect((await jobsFor(w.db, w.sam, new Date("2026-10-20T11:30:00Z"))).jobs[0].status).toBe("overdue");
  });

  it("a deadline for a trip already in the diary links to it", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [{ ...card({ kind: "trip", title: "Residential", startDate: "2026-11-02", endDate: "2026-11-04", location: "Kingswood" }), adultIds: [w.alex.accountId] }]);
    const t = (await w.db.select().from(trips))[0];
    expect(t.destination).toBe("Kingswood");
    await imp(w, w.alex, [
      { ...card({ kind: "trip", title: "Residential", startDate: "2026-11-02", endDate: "2026-11-04", location: "Kingswood" }), adultIds: [w.alex.accountId], action: "existing" },
      { ...card({ ref: "c2", title: "Residential consent form", startDate: "2026-10-16", endDate: "2026-10-16", startTime: null, endTime: null, allDay: true }), kind: "job", forRef: "c1" },
    ]);
    const [job] = await w.db.select().from(jobs);
    expect(job).toMatchObject({ forType: "trip", forId: t.id, dueTime: null, remindDayBefore: true });
  });

  it("fingerprints are the same on the phone and the server, and carry no words", async () => {
    const w = await newWorld();
    const k = await deskKeys(w.householdId, card() as never, null);
    expect(k.identityKey).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(k)).not.toMatch(/Science|Museum|lunch/i);
    // Node's own SHA-256 over the same fields gives the same fingerprint as the WebCrypto one the phone uses.
    const h = (...parts: string[]) => createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 40);
    const series = h(w.householdId, "shared", "event", normTitle(card().title), "");
    expect(k.seriesKey).toBe(series);
    expect(k.identityKey).toBe(h(series, "2026-11-12", "09:00"));
  });
});
