import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { events, jobs, notifications, outbox, weatherForecasts } from "@/db/schema";
import type { HourPoint } from "@/domain/weather";
import { processOutbox } from "@/server/outbox";
import { queueWeatherSwaps } from "@/server/weather";
import { dayTitleKey, diaryTimes } from "@/lib/desk-keys";
import { checkDesk, deskKeys, type DeskCheckInput, type DeskStatus } from "@/server/desk";
import { accountFor } from "@/server/auth";
import { executeCommand } from "@/server/commands";
import { jobsFor } from "@/server/queries/jobs";
import { expectCode, newWorld, timed, type World } from "./harness";

/**
 * Corrections from Marlon's review of PR #11 (2026-10-08). Each test
 * reproduces a finding against the first quality-release commit (3e2791a).
 */

const NOW = new Date("2026-10-07T09:00:00Z");

/** A second, unrelated household in the same database. */
async function otherHousehold(w: World) {
  const casey = await accountFor(w.db, { subject: "test:casey", displayName: "Casey" });
  const made = await executeCommand(casey, { command: "CreateHousehold", idempotencyKey: randomUUID(), payload: { name: "The Neighbours" } });
  const householdId = (made.result as { householdId: string }).householdId;
  const run = async (command: string, payload: unknown) => (await executeCommand(casey, { command, householdId, idempotencyKey: randomUUID(), payload })).result as Record<string, string>;
  return { casey, householdId, run };
}

const job = (over: Record<string, unknown>) => ({ title: "Pay for it", notes: "", cadence: "once", startsOn: "2026-10-20", remindDayBefore: false, minutes: 10, ...over });

describe("Q01: a job can only be linked to its own household's diary", () => {
  it("refuses another household's shared event or trip, and never shows its title", async () => {
    const w = await newWorld();
    const n = await otherHousehold(w);
    const { eventId } = await n.run("AddEvent", { title: "NEIGHBOURS secret party", span: timed("2026-10-20", "19:00", "23:00"), adultIds: [n.casey.accountId] });
    const { tripId } = await n.run("AddTrip", { kind: "work", title: "NEIGHBOURS trip", destination: "Rome", startDate: "2026-10-21", startTime: "08:00", endDate: "2026-10-22", endTime: "20:00", travellerIds: [n.casey.accountId] });
    await expectCode(w.run(w.alex, "AddJob", job({ forType: "event", forId: eventId })), "NOT_FOUND");
    await expectCode(w.run(w.alex, "AddJob", job({ forType: "trip", forId: tripId })), "NOT_FOUND");

    // A reference planted directly in the database still reveals nothing.
    const { jobId } = await w.run(w.alex, "AddJob", job({}));
    await w.db.update(jobs).set({ forType: "event", forId: eventId }).where(eq(jobs.id, jobId));
    const { jobId: j2 } = await w.run(w.alex, "AddJob", job({ title: "Second" }));
    await w.db.update(jobs).set({ forType: "trip", forId: tripId }).where(eq(jobs.id, j2));
    const view = await jobsFor(w.db, w.alex, NOW);
    expect(view.jobs.map((j) => j.forTitle)).toEqual([null, null]);
    expect(JSON.stringify(view)).not.toMatch(/NEIGHBOURS/);
  });

  it("links within the household, and respects a private entry", async () => {
    const w = await newWorld();
    const { eventId: shared } = await w.run(w.alex, "AddEvent", { title: "Year 4 trip", span: timed("2026-10-20", "09:00", "15:00"), adultIds: [w.alex.accountId] });
    const { eventId: mine } = await w.run(w.alex, "AddEvent", { title: "PRIVATE gift shopping", visibility: "private", span: timed("2026-10-21", "09:00", "10:00"), adultIds: [w.alex.accountId] });
    await w.run(w.alex, "AddJob", job({ forType: "event", forId: shared }));
    await w.run(w.alex, "AddJob", job({ title: "Wrap it", forType: "event", forId: mine }));
    // Sam can't link to Alex's private entry.
    await expectCode(w.run(w.sam, "AddJob", job({ forType: "event", forId: mine })), "NOT_FOUND");
    const forAlex = (await jobsFor(w.db, w.alex, NOW)).jobs.map((j) => j.forTitle).sort();
    expect(forAlex).toEqual(["PRIVATE gift shopping", "Year 4 trip"]);
    const forSam = (await jobsFor(w.db, w.sam, NOW)).jobs.map((j) => j.forTitle);
    expect(forSam).toContain("Year 4 trip");
    expect(JSON.stringify(forSam)).not.toMatch(/PRIVATE/);
  });
});

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
  details: "Packed lunch",
  childIds: [] as string[],
  justMe: false,
  action: "add",
  ...over,
});
type Card = ReturnType<typeof card>;

async function statusOf(w: World, viewer: World["alex"], c: Card): Promise<DeskStatus> {
  const keys = await deskKeys(w.householdId, c as never, c.justMe ? viewer.accountId : null);
  const t = diaryTimes(c as never);
  const item: DeskCheckInput = { ref: c.ref, kind: c.kind as never, startDate: c.startDate, startTime: t.startTime, endDate: t.endDate, endTime: t.endTime, ...keys, dayTitleKey: await dayTitleKey(w.householdId, c.startDate, c.title) };
  return (await checkDesk(w.db, viewer, w.householdId, [item]))[0];
}
const imp = (w: World, who: World["alex"], items: unknown[]) => w.run(who, "ImportDeskItems", { items });
const liveEvents = (w: World) => w.db.select().from(events).where(and(eq(events.householdId, w.householdId), isNull(events.cancelledAt)));
const fieldsOf = (e: typeof events.$inferSelect, over: Record<string, unknown> = {}) => ({
  title: e.title,
  notes: e.notes,
  location: e.location,
  visibility: e.visibility,
  span: timed(e.localStart.slice(0, 10), e.localStart.slice(11, 16), "15:15"),
  adultIds: e.adultIds,
  childIds: e.childIds,
  travelBeforeMinutes: e.travelBeforeMinutes,
  travelAfterMinutes: e.travelAfterMinutes,
  rule: e.rule,
  ...over,
});

describe("Q02: a Desk update never overwrites newer or hand-made changes", () => {
  it("a stale preview conflicts; a fresh one keeps travel, notes and people", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [card()]);
    const changed = card({ endTime: "16:00" });
    const seen = (await statusOf(w, w.sam, changed)) as Extract<DeskStatus, { status: "changed" }>;
    expect(seen.status).toBe("changed");

    // Alex edits the entry by hand after Sam looked.
    const [e] = await liveEvents(w);
    await w.run(w.alex, "UpdateEvent", { eventId: e.id, version: e.version, fields: fieldsOf(e, { notes: `${e.notes}\nAlex driving`, travelBeforeMinutes: 30, adultIds: [w.alex.accountId] }) });
    await expectCode(imp(w, w.sam, [{ ...changed, action: "update", targetId: seen.current.targetId, targetVersion: seen.current.version }]), "CONFLICT");

    // Looking again shows the newer version; updating from it keeps what Alex added.
    const fresh = (await statusOf(w, w.sam, changed)) as Extract<DeskStatus, { status: "changed" }>;
    await imp(w, w.sam, [{ ...changed, action: "update", targetId: fresh.current.targetId, targetVersion: fresh.current.version }]);
    const [after] = await liveEvents(w);
    expect(after.durationMinutes).toBe(7 * 60);
    expect(after.travelBeforeMinutes).toBe(30);
    expect(after.adultIds).toEqual([w.alex.accountId]);
    expect(after.notes).toContain("Alex driving");
    expect(after.notes.match(/Packed lunch/g)).toHaveLength(1);
  });

  it("a repeating entry is never rewritten from a letter", async () => {
    const w = await newWorld();
    const swim = card({ title: "Swimming club", startDate: "2026-10-13", endDate: "2026-10-13", startTime: "16:00", endTime: "17:00", location: "Pool", details: "", repeat: "weekly", repeatUntil: "2026-12-15" });
    await imp(w, w.alex, [swim]);
    const s = (await statusOf(w, w.alex, { ...swim, endTime: "17:30" })) as Extract<DeskStatus, { status: "changed" }>;
    expect(s.current.recurring).toBe(true);
    await expectCode(imp(w, w.alex, [{ ...swim, endTime: "17:30", action: "update", targetId: s.current.targetId, targetVersion: s.current.version }]), "VALIDATION");
    expect((await liveEvents(w))[0].durationMinutes).toBe(60);
  });
});

describe("Q03: changes the old fingerprint missed", () => {
  it.each([
    ["arrival time only", { arriveBy: "08:30" }, { arriveBy: "08:45" }],
    ["repeat frequency only", { repeat: "weekly", repeatUntil: "2026-12-15" }, { repeat: "fortnightly", repeatUntil: "2026-12-15" }],
    ["repeat end only", { repeat: "weekly", repeatUntil: "2026-12-15" }, { repeat: "weekly", repeatUntil: "2027-02-15" }],
  ])("%s is offered for review, not called already there", async (_, first, second) => {
    const w = await newWorld();
    await imp(w, w.alex, [card(first)]);
    expect((await statusOf(w, w.alex, card(first))).status).toBe("added");
    expect((await statusOf(w, w.alex, card(second))).status).toBe("changed");
  });

  it("a hand edit in the diary shows when the same letter is read again", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [card()]);
    const [e] = await liveEvents(w);
    await w.run(w.alex, "UpdateEvent", { eventId: e.id, version: e.version, fields: fieldsOf(e, { span: timed("2026-11-12", "10:00", "15:15") }) });
    expect(await statusOf(w, w.sam, card())).toMatchObject({ status: "changed", current: { startTime: "10:00" } });
  });

  it("made private, it stops showing up in the other adult's check at once", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [card()]);
    const [e] = await liveEvents(w);
    await w.run(w.alex, "UpdateEvent", { eventId: e.id, version: e.version, fields: fieldsOf(e, { visibility: "private", adultIds: [w.alex.accountId] }) });
    const s = await statusOf(w, w.sam, card());
    expect(s.status).toBe("new");
    expect(JSON.stringify(s)).not.toContain(e.id);
  });
});

describe("Q04: another session or a move is a question, not a claim", () => {
  it("a second session in a later letter is offered as possible, with the first shown", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [card()]);
    const s = await statusOf(w, w.alex, card({ startTime: "13:00", endTime: "14:00" }));
    expect(s).toMatchObject({ status: "possible", sameDay: true, candidates: [{ startTime: "09:00" }] });
    // Keeping both works.
    await imp(w, w.alex, [card({ startTime: "13:00", endTime: "14:00" })]);
    expect(await liveEvents(w)).toHaveLength(2);
  });

  it("several nearby matches are all shown, not the first row picked", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [card({ title: "Swimming" }), card({ ref: "c2", title: "Swimming", startDate: "2026-11-19", endDate: "2026-11-19" })]);
    const s = await statusOf(w, w.alex, card({ title: "Swimming", startDate: "2026-11-26", endDate: "2026-11-26" }));
    expect(s).toMatchObject({ status: "possible", sameDay: false });
    expect((s as Extract<DeskStatus, { status: "possible" }>).candidates.map((c) => c.startDate)).toEqual(["2026-11-12", "2026-11-19"]);
  });
});

describe("Q05: asking the other adult to collect is a request", () => {
  it("the partner is asked, nothing says they'll collect, and a decline leaves it open", async () => {
    const w = await newWorld();
    const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId;
    const early = card({ title: "School closes early", allDay: true, startTime: null, endTime: null, location: "", details: "", childIds: [mia], collect: "partner", collectAt: "13:30", adultIds: [w.alex.accountId] });
    await imp(w, w.alex, [early]);
    const [e] = await liveEvents(w);
    expect(e.adultIds).toEqual([]);
    const job = (await jobsFor(w.db, w.sam, NOW)).jobs[0];
    expect(job).toMatchObject({ title: "Collect Mia at 13:30", ownerId: null, proposedOwnerId: w.sam.accountId, awaitingMyAnswer: true, dueTime: "13:30", forTitle: "School closes early" });

    await w.run(w.sam, "AnswerJobOwner", { jobId: job.id, version: job.version, accept: false });
    const after = (await jobsFor(w.db, w.alex, NOW)).jobs[0];
    expect(after).toMatchObject({ ownerId: null, proposedOwnerId: null });
    expect((await jobsFor(w.db, w.alex, NOW)).unowned).toBeDefined();
  });

  it("choosing yourself takes it on straight away", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [card({ title: "School closes early", allDay: true, startTime: null, endTime: null, collect: "me", collectAt: "13:30" })]);
    expect((await jobsFor(w.db, w.alex, NOW)).jobs[0]).toMatchObject({ title: "Collect the children at 13:30", ownerId: w.alex.accountId, proposedOwnerId: null });
  });
});

describe("Q06: a repeat stops at its end date", () => {
  const monthly = async (startDate: string, repeatUntil: string) => {
    const w = await newWorld();
    await imp(w, w.alex, [card({ title: "Club", startDate, endDate: startDate, repeat: "monthly", repeatUntil })]);
    return (await liveEvents(w))[0].rule as { count: number };
  };
  it.each([
    ["the review's example", "2026-10-20", "2026-11-01", 1],
    ["the day before the next one", "2026-10-20", "2026-11-19", 1],
    ["on the next one", "2026-10-20", "2026-11-20", 2],
    ["the day after", "2026-10-20", "2026-11-21", 2],
    ["leap day", "2028-02-29", "2028-05-01", 3],
  ])("%s", async (_, start, until, count) => {
    expect((await monthly(start, until)).count).toBe(count);
  });

  it("month ends follow the diary's own monthly rule, never past the end date", async () => {
    const { count } = await monthly("2026-01-31", "2026-04-30");
    expect(count).toBeLessThanOrEqual(3);
  });

  it("an end date before the start is refused, not made open-ended", async () => {
    const w = await newWorld();
    await expectCode(imp(w, w.alex, [card({ repeat: "weekly", repeatUntil: "2026-11-01" })]), "VALIDATION");
  });
});

describe("weather alerts never give a surprise away (priority 1, now exercised)", () => {
  const SAT = new Date("2030-10-11T09:00:00Z");
  const wet = (): HourPoint[] => {
    const out: HourPoint[] = [];
    for (let t = Date.parse("2030-10-11T00:00:00Z"); t < Date.parse("2030-10-14T00:00:00Z"); t += 3_600_000) {
      const rain = t >= Date.parse("2030-10-12T12:00:00Z") && t < Date.parse("2030-10-12T16:00:00Z");
      out.push({ t, rain: rain ? 85 : 10, mm: rain ? 1.2 : 0, code: rain ? 63 : 2, temp: 12 });
    }
    return out;
  };

  it("only the organiser hears about rain or a swap; the other adult hears nothing naming it", async () => {
    const w = await newWorld();
    await w.run(w.alex, "SetHouseholdLocation", { placeName: "Guildford, England", latitude: 51.2362, longitude: -0.5704 });
    await w.db.insert(weatherForecasts).values({ householdId: w.householdId, fetchedAt: SAT, hours: wet() });
    const m = await w.run(w.alex, "CreateMoment", { kind: "family", title: "SECRET woodland birthday", activityKey: "fam-woodland-walk", surprise: true, span: timed("2030-10-12", "13:00", "15:00"), participantIds: [w.alex.accountId, w.sam.accountId] });
    await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
    const mv = (await w.week(w.sam, "2030-10-07", SAT)).moments.find((x) => x.id === m.momentId)!;
    await w.run(w.sam, "RespondToMoment", { momentId: m.momentId, materialVersion: mv.materialVersion, decision: "accepted" });

    expect(await queueWeatherSwaps(w.db, SAT)).toEqual({ queued: 1 });
    const queued = (await w.db.select().from(outbox)).filter((o) => o.dedupeKey?.startsWith("notify:weather.swap"));
    expect(queued.map((o) => (o.payload as { recipientId: string }).recipientId)).toEqual([w.alex.accountId]);

    const mine = (await w.week(w.alex, "2030-10-07", SAT)).moments.find((x) => x.id === m.momentId)!;
    await w.run(w.alex, "SwapActivity", { momentId: m.momentId, version: mine.version, title: "Indoor den", activityKey: null });
    await processOutbox(w.db, new Date("2030-10-11T09:05:00Z"));
    const toSam = await w.db.select().from(notifications).where(eq(notifications.accountId, w.sam.accountId));
    expect(JSON.stringify(toSam)).not.toMatch(/SECRET|woodland|Indoor den|rain/i);
  });
});

/*
 * Marlon's second review of PR #11 (2026-10-08 10:29 UTC): R1–R3. Each test
 * reproduces a finding against 7f1ce52.
 */

describe("R1: a private pickup never reaches the other adult", () => {
  it("a 'just for me' pickup or job is refused on the server, and nothing lands", async () => {
    const w = await newWorld();
    const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId;
    const secret = card({ title: "SECRET spa day", allDay: true, startTime: null, endTime: null, location: "", details: "", childIds: [mia], justMe: true, collect: "partner", collectAt: "12:30" });
    await expectCode(imp(w, w.alex, [secret]), "VALIDATION");
    await expectCode(imp(w, w.alex, [{ ...secret, collect: "me" }]), "VALIDATION");
    await expectCode(imp(w, w.alex, [{ ...secret, collect: "none" }]), "VALIDATION");
    await expectCode(imp(w, w.alex, [card({ kind: "job", title: "SECRET deposit", justMe: true, endTime: null })]), "VALIDATION");
    expect(await liveEvents(w)).toEqual([]);
    expect(await w.db.select().from(jobs)).toEqual([]);
    // Without the pickup it stays private, as before.
    await imp(w, w.alex, [{ ...secret, collect: null, collectAt: null }]);
    expect((await liveEvents(w))[0].visibility).toBe("private");
  });

  it("the partner's jobs, notifications and export carry no private title; the shared care need stays", async () => {
    const w = await newWorld();
    const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId;
    // Alex's private plan that day, and the school's early close asking Sam to collect.
    await imp(w, w.alex, [card({ ref: "p", title: "SECRET spa day", startDate: "2026-11-12", endDate: "2026-11-12", startTime: "11:00", endTime: "16:00", location: "", details: "", justMe: true })]);
    await imp(w, w.alex, [card({ ref: "k", title: "School closes early", allDay: true, startTime: null, endTime: null, location: "", details: "", childIds: [mia], collect: "partner", collectAt: "12:30" })]);
    await processOutbox(w.db, new Date(Date.now() + 60_000));

    const forSam = await jobsFor(w.db, w.sam, NOW);
    expect(forSam.jobs[0]).toMatchObject({ title: "Collect Mia at 12:30", dueTime: "12:30", startsOn: "2026-11-12", proposedOwnerId: w.sam.accountId, forTitle: "School closes early" });
    expect(JSON.stringify(forSam)).not.toMatch(/SECRET|spa/i);
    const toSam = await w.db.select().from(notifications).where(eq(notifications.accountId, w.sam.accountId));
    expect(toSam.length).toBeGreaterThan(0);
    expect(JSON.stringify(toSam)).not.toMatch(/SECRET|spa/i);
    const { exportHousehold } = await import("@/server/queries/exports");
    expect(JSON.stringify(await exportHousehold(w.db, w.sam))).not.toMatch(/SECRET|spa/i);
  });
});

describe("R2: a pickup's collection is never left at the old time", () => {
  const pickup = (mia: string, over: Record<string, unknown> = {}) =>
    card({ title: "School closes early", allDay: true, startTime: null, endTime: null, location: "", details: "", childIds: [mia], collect: "partner", collectAt: "13:30", ...over });
  const setup = async () => {
    const w = await newWorld();
    const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId;
    await imp(w, w.alex, [pickup(mia)]);
    return { w, mia };
  };

  it("a change to the collection time alone is offered for review, not called already there", async () => {
    const { w, mia } = await setup();
    expect((await statusOf(w, w.alex, pickup(mia))).status).toBe("added");
    expect(await statusOf(w, w.alex, pickup(mia, { collectAt: "12:30" }))).toMatchObject({ status: "changed", current: { linkedJobs: 1 } });
  });

  it("after the partner agreed, a moved date can't be applied from the letter; the job and its yes stay as they were", async () => {
    const { w, mia } = await setup();
    const asked = (await jobsFor(w.db, w.sam, NOW)).jobs[0];
    await w.run(w.sam, "AnswerJobOwner", { jobId: asked.id, version: asked.version, accept: true });
    const moved = pickup(mia, { startDate: "2026-11-13", endDate: "2026-11-13" });
    const s = (await statusOf(w, w.alex, moved)) as Extract<DeskStatus, { status: "possible" }>;
    expect(s).toMatchObject({ status: "possible", candidates: [{ linkedJobs: 1 }] });
    await expectCode(imp(w, w.alex, [{ ...moved, action: "update", targetId: s.candidates[0].targetId, targetVersion: s.candidates[0].version }]), "VALIDATION");
    expect((await liveEvents(w))[0].localStart.slice(0, 10)).toBe("2026-11-12");
    expect((await jobsFor(w.db, w.alex, NOW)).jobs[0]).toMatchObject({ startsOn: "2026-11-12", dueTime: "13:30", ownerId: w.sam.accountId, remindDayBefore: true });
  });

  it("while the request is still waiting, a changed collection time can't be applied either", async () => {
    const { w, mia } = await setup();
    const changed = pickup(mia, { collectAt: "12:30" });
    const s = (await statusOf(w, w.alex, changed)) as Extract<DeskStatus, { status: "changed" }>;
    await expectCode(imp(w, w.alex, [{ ...changed, action: "update", targetId: s.current.targetId, targetVersion: s.current.version }]), "VALIDATION");
    expect((await jobsFor(w.db, w.sam, NOW)).jobs[0]).toMatchObject({ title: "Collect Mia at 13:30", dueTime: "13:30", proposedOwnerId: w.sam.accountId, awaitingMyAnswer: true });
  });

  it("a collection time corrected on the card before adding is the one the job and its reminder use", async () => {
    const w = await newWorld();
    const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId;
    // The reader said 13:30; the parent corrected it to 12:30 before adding.
    await imp(w, w.alex, [pickup(mia, { collectAt: "12:30" })]);
    expect((await jobsFor(w.db, w.sam, NOW)).jobs[0]).toMatchObject({ title: "Collect Mia at 12:30", dueTime: "12:30", startsOn: "2026-11-12", remindDayBefore: true });
  });

  it("a changed letter that adds a pickup to an entry with no job gets its collection", async () => {
    const w = await newWorld();
    const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId;
    await imp(w, w.alex, [pickup(mia, { collect: null, collectAt: null })]);
    const changed = pickup(mia, { collect: "me", collectAt: "12:30" });
    const s = (await statusOf(w, w.alex, changed)) as Extract<DeskStatus, { status: "changed" }>;
    expect(s.current.linkedJobs).toBe(0);
    await imp(w, w.alex, [{ ...changed, action: "update", targetId: s.current.targetId, targetVersion: s.current.version }]);
    expect((await jobsFor(w.db, w.alex, NOW)).jobs[0]).toMatchObject({ title: "Collect Mia at 12:30", ownerId: w.alex.accountId });
  });
});

describe("R3: a changed letter replaces its own instructions and keeps the parent's", () => {
  const trip = (over: Record<string, unknown> = {}) => card({ startTime: "09:00", arriveBy: "08:45", details: "Bring £3 and a packed lunch", ...over });
  const update = async (w: World, c: Card) => {
    const s = (await statusOf(w, w.alex, c)) as Extract<DeskStatus, { status: "changed" }>;
    expect(s.status).toBe("changed");
    await imp(w, w.alex, [{ ...c, action: "update", targetId: s.current.targetId, targetVersion: s.current.version }]);
  };

  it("amount, arrival and kit change; only the current instructions stay; a manual note survives; repeating adds nothing", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [trip()]);
    const [e] = await liveEvents(w);
    expect(e.notes).toBe("From the letter:\n• Bring £3 and a packed lunch\n• Arrive by 08:45; it starts at 09:00.");
    await w.run(w.sam, "UpdateEvent", { eventId: e.id, version: e.version, fields: fieldsOf(e, { span: timed("2026-11-12", "08:45", "15:15"), notes: `Alex driving\n${e.notes}` }) });

    const newer = trip({ arriveBy: "08:30", details: "Bring £5, a packed lunch and PE kit" });
    await update(w, newer);
    const [after] = await liveEvents(w);
    expect(after.notes).toBe("Alex driving\nFrom the letter:\n• Bring £5, a packed lunch and PE kit\n• Arrive by 08:30; it starts at 09:00.");
    expect(after.notes).not.toMatch(/£3|08:45/);
    expect(after.localStart.slice(11, 16)).toBe("08:30");

    // The same letter again is already there; forcing the update again changes nothing.
    expect((await statusOf(w, w.alex, newer)).status).toBe("added");
    const [again] = await liveEvents(w);
    await w.run(w.alex, "UpdateEvent", { eventId: again.id, version: again.version, fields: fieldsOf(again, { span: timed("2026-11-12", "08:45", "15:15") }) });
    await update(w, newer);
    expect((await liveEvents(w))[0].notes).toBe(after.notes);
  });

  it("notes from before the heading existed are sorted out by hand, not guessed at", async () => {
    const w = await newWorld();
    await imp(w, w.alex, [trip()]);
    const [e] = await liveEvents(w);
    await w.db.update(events).set({ notes: "Bring £3 and a packed lunch\nAlex driving" }).where(eq(events.id, e.id));
    const newer = trip({ details: "Bring £5" });
    const s = (await statusOf(w, w.alex, newer)) as Extract<DeskStatus, { status: "changed" }>;
    expect(s.current.mixedNotes).toBe(true);
    await expectCode(imp(w, w.alex, [{ ...newer, action: "update", targetId: s.current.targetId, targetVersion: s.current.version }]), "VALIDATION");
    expect((await liveEvents(w))[0].notes).toBe("Bring £3 and a packed lunch\nAlex driving");
  });
});
