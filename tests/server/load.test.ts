import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { jobs, notifications, outbox } from "@/db/schema";
import { queueJobReminders } from "@/server/jobs";
import { processOutbox } from "@/server/outbox";
import { calendarFeed } from "@/server/queries/calendar-out";
import { jobsFor } from "@/server/queries/jobs";
import { picksFor } from "@/server/queries/picks";
import { DATE_NIGHT_KEY, menuFromNotes, menuToNotes } from "@/lib/date-night";
import { freeTimesFor } from "@/server/queries/free-time";
import { expectCode, newWorld, timed } from "./harness";

const notes = async (w: Awaited<ReturnType<typeof newWorld>>, accountId: string) =>
  (await w.db.select().from(notifications).where(eq(notifications.accountId, accountId))).map((n) => n.text);

describe("household jobs: one agreed owner each", () => {
  it("asking a partner needs their yes; the share view counts only agreed owners", async () => {
    const w = await newWorld();
    const { jobId } = await w.run(w.alex, "AddJob", { title: "Bins out", cadence: "weekly", startsOn: "2030-10-08", remindDayBefore: true, minutes: 10, owner: "partner" });
    const now = new Date("2030-10-06T12:00:00Z");
    let sam = await jobsFor(w.db, w.sam, now);
    expect(sam.jobs[0]).toMatchObject({ ownerId: null, awaitingMyAnswer: true, proposedByName: "Alex" });
    expect(sam.unowned.jobs).toBe(1);
    await processOutbox(w.db, now);
    expect(await notes(w, w.sam.accountId)).toContain("Alex asked if you could take on “Bins out”.");

    // Alex can't answer on Sam's behalf.
    await expectCode(w.run(w.alex, "AnswerJobOwner", { jobId, version: sam.jobs[0].version, accept: true }), "CONFLICT");
    await w.run(w.sam, "AnswerJobOwner", { jobId, version: sam.jobs[0].version, accept: true });
    sam = await jobsFor(w.db, w.sam, now);
    expect(sam.jobs[0]).toMatchObject({ ownerName: "Sam", awaitingMyAnswer: false });
    expect(sam.share.find((s) => s.name === "Sam")).toMatchObject({ jobs: 1, minutesPerMonth: 43 });

    // Only the owner can put a job back in the shared list.
    await expectCode(w.run(w.alex, "ProposeJobOwner", { jobId, version: sam.jobs[0].version, to: "none" }), "FORBIDDEN");
    await processOutbox(w.db, now);
    expect(await notes(w, w.alex.accountId)).toContain("Sam is taking on “Bins out”.");
  });

  it("reminds the owner the evening before, and never after it's done or handed on", async () => {
    const w = await newWorld();
    const { jobId } = await w.run(w.alex, "AddJob", { title: "Bins out", cadence: "weekly", startsOn: "2030-10-08", remindDayBefore: true, owner: "me" });
    const monday = new Date("2030-10-07T08:00:00Z");
    expect((await queueJobReminders(w.db, monday)).queued).toBe(1);
    expect((await queueJobReminders(w.db, monday)).queued).toBe(0);
    const [job] = await w.db.select().from(outbox).where(and(eq(outbox.eventType, "notify"), eq(outbox.dedupeKey, `notify:job.due:${jobId}:20301008:${w.alex.accountId}`)));
    expect(job.availableAt.toISOString()).toBe("2030-10-07T17:00:00.000Z"); // 18:00 BST

    // Sam does it early: Alex's reminder is dropped, and Alex hears Sam covered it.
    await w.run(w.sam, "MarkJobDone", { jobId, dueOn: "2030-10-08" });
    await processOutbox(w.db, new Date("2030-10-07T18:00:00Z"));
    const alexNotes = await notes(w, w.alex.accountId);
    expect(alexNotes).toContain("Sam did “Bins out” for you.");
    expect(alexNotes.some((t) => t.startsWith("For tomorrow"))).toBe(false);

    // Next week: Alex hands it to Sam; Alex's queued reminder no longer fires.
    await queueJobReminders(w.db, new Date("2030-10-14T08:00:00Z"));
    const [row] = await w.db.select().from(jobs).where(eq(jobs.id, jobId));
    await w.run(w.alex, "ProposeJobOwner", { jobId, version: row.version, to: "partner" });
    const proposed = (await jobsFor(w.db, w.sam, new Date("2030-10-14T09:00:00Z"))).jobs[0];
    await w.run(w.sam, "AnswerJobOwner", { jobId, version: proposed.version, accept: true });
    await processOutbox(w.db, new Date("2030-10-14T18:00:00Z"));
    expect((await notes(w, w.alex.accountId)).filter((t) => t.startsWith("For tomorrow"))).toHaveLength(0);
    await queueJobReminders(w.db, new Date("2030-10-14T09:00:00Z"));
    await processOutbox(w.db, new Date("2030-10-14T18:00:00Z"));
    expect(await notes(w, w.sam.accountId)).toContain("For tomorrow: Bins out.");
  });

  it("when an adult leaves, their jobs go back to the shared list", async () => {
    const w = await newWorld();
    await w.run(w.sam, "AddJob", { title: "Swimming bag", cadence: "weekly", startsOn: "2030-10-09", owner: "me" });
    await w.run(w.sam, "LeaveHousehold", { confirm: true });
    expect((await jobsFor(w.db, w.alex, new Date("2030-10-06T12:00:00Z"))).jobs[0].ownerId).toBeNull();
  });
});

describe("our places", () => {
  it("come first in picks and carry their location into the plan", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddPlace", { name: "The Boathouse", area: "Guildford", kinds: ["us"], category: "food", setting: "out-indoors", typicalCostMinor: 4000, durationMinutes: 120 });
    // For Us ideas are private, so the place is on exactly one partner's shelf.
    const at = new Date("2030-10-06T12:00:00Z");
    const found = await Promise.all([w.alex, w.sam].map(async (who) => (await picksFor(w.db, who, "us", at, { count: 3 })).picks.find((p) => p.activity.local)));
    expect(found.filter(Boolean)).toHaveLength(1);
    expect(found.find(Boolean)?.activity).toMatchObject({ title: "The Boathouse", location: "The Boathouse, Guildford" });
    expect((await w.week(w.sam, "2030-10-07")).places.map((p) => p.name)).toEqual(["The Boathouse"]);
    await expectCode(w.run(w.alex, "AddPlace", { name: "Nowhere", kinds: [], category: "food", setting: "home" }), "VALIDATION");
  });
});

describe("For Us picks are private to each partner", () => {
  it("never shows both partners the same idea, week after week", async () => {
    const w = await newWorld();
    for (const day of ["2030-10-06", "2030-10-13", "2030-10-20"]) {
      const at = new Date(`${day}T12:00:00Z`);
      const keys = async (who: typeof w.alex) => (await picksFor(w.db, who, "us", at, { count: 3 })).picks.map((p) => p.activity.key);
      const [alex, sam] = [await keys(w.alex), await keys(w.sam)];
      expect(alex.length).toBeGreaterThan(0);
      expect(alex.filter((k) => sam.includes(k))).toEqual([]);
    }
    // Family picks stay shared.
    const at = new Date("2030-10-06T12:00:00Z");
    const fam = async (who: typeof w.alex) => (await picksFor(w.db, who, "family", at, { count: 3 })).picks.map((p) => p.activity.key);
    expect(await fam(w.alex)).toEqual(await fam(w.sam));
  });
});

describe("plans in your own calendar", () => {
  it("shows agreed plans, keeps a partner's me-time private, and a new link kills the old", async () => {
    const w = await newWorld();
    const people = [w.alex.accountId, w.sam.accountId];
    const d = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Dinner, Italian", location: "Zia's", span: timed("2030-10-11", "19:30", "22:00"), participantIds: people });
    await w.run(w.alex, "ShareMoment", { momentId: d.momentId, version: d.version });
    await w.run(w.sam, "RespondToMoment", { momentId: d.momentId, materialVersion: 1, decision: "accepted" });
    const me = await w.run(w.sam, "CreateMoment", { kind: "me", title: "Therapy", notes: "private", span: timed("2030-10-09", "18:00", "19:00"), participantIds: [w.sam.accountId] });
    await w.run(w.sam, "ShareMoment", { momentId: me.momentId, version: me.version });

    const { token } = await w.run(w.alex, "CreateCalendarLink", {}, { householdId: undefined });
    const ics = (await calendarFeed(w.db, token, new Date("2030-10-06T12:00:00Z")))!;
    expect(ics).toContain("SUMMARY:Dinner\\, Italian");
    expect(ics).toContain("LOCATION:Zia's");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("SUMMARY:Sam: time for themselves");
    expect(ics).not.toContain("Therapy");
    expect(ics).not.toContain("private");

    const { token: fresh } = await w.run(w.alex, "CreateCalendarLink", {}, { householdId: undefined });
    expect(await calendarFeed(w.db, token)).toBeNull();
    expect(await calendarFeed(w.db, fresh)).toContain("BEGIN:VCALENDAR");
    expect(await calendarFeed(w.db, "../../etc")).toBeNull();
  });
});

describe("date night concierge", () => {
  it("sends the menu as an invitation the partner can answer, at a sensible time", async () => {
    const w = await newWorld();
    const now = new Date("2030-10-07T08:00:00Z");
    const free = await freeTimesFor(w.db, w.alex, "us", 210, now, 14, ["18:30", "19:30"]);
    expect(free.slots.length).toBeGreaterThan(0);
    expect(free.slots.every((s) => s.startTime >= "18:30" && s.startTime <= "19:30")).toBe(true);

    const menu = { entree: "A drink with a view", plat: "Dinner at Zia's", dessert: "A crêpe on the walk home", note: "Wear the blue." };
    const s = free.slots[0];
    const d = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Date night", notes: menuToNotes(menu), activityKey: DATE_NIGHT_KEY, span: timed(s.date, s.startTime, s.endTime), participantIds: [w.alex.accountId, w.sam.accountId], needsCare: true, budgetMinor: 6000 });
    await w.run(w.alex, "ShareMoment", { momentId: d.momentId, version: d.version });
    const seen = (await w.week(w.sam, "2030-10-07", now)).moments.find((m) => m.id === d.momentId)!;
    expect(seen.activityKey).toBe(DATE_NIGHT_KEY);
    expect(menuFromNotes(seen.notes)).toEqual(menu);
    await w.run(w.sam, "RespondToMoment", { momentId: d.momentId, materialVersion: seen.materialVersion, decision: "accepted" });
  });
});
