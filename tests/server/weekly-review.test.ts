import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { groupDecisions } from "@/domain/decisions";
import { decisionsFor } from "@/server/queries/decisions";
import { jobsFor } from "@/server/queries/jobs";
import { reviewRange } from "@/server/queries/review-range";
import { getProjection } from "@/server/queries/week";
import type { Actor } from "@/server/auth";
import { newWorld, timed, type World } from "./harness";

// Sunday 6 October 2030, 10:00 in London: the review covers today to Sunday 13th.
const NOW = new Date("2030-10-06T09:00:00Z");
const TZ = "Europe/London";

async function review(w: World, who: Actor, now = NOW) {
  const range = reviewRange(now, TZ);
  const view = await getProjection(w.db, who, range.from, range.days, now);
  const items = decisionsFor(view, await jobsFor(w.db, who, now), range, now);
  return { items, groups: groupDecisions(items), range };
}

async function family(w: World) {
  const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId as string;
  return { mia };
}

describe("weekly review: connect existing decisions", () => {
  it("covers today to the end of the planned week, so Today and Sunday count the same things", () => {
    expect(reviewRange(NOW, TZ)).toMatchObject({ from: "2030-10-06", to: "2030-10-14", lastDay: "2030-10-13" });
    // Friday: the planned week is next week, and the rest of this week stays in view.
    expect(reviewRange(new Date("2030-10-11T09:00:00Z"), TZ)).toMatchObject({ from: "2030-10-11", to: "2030-10-21" });
    // Tuesday: this week.
    expect(reviewRange(new Date("2030-10-08T09:00:00Z"), TZ)).toMatchObject({ from: "2030-10-08", to: "2030-10-14" });
  });

  it("gives each adult their own decisions, keeps each record's status, and never shows a request as agreed", async () => {
    const w = await newWorld();
    const { mia } = await family(w);
    // A school deadline nobody owns yet (as the Desk files it), and a job Alex asks Sam to take.
    const form = (await w.run(w.alex, "AddJob", { title: "Trip consent form", cadence: "once", startsOn: "2030-10-09", dueTime: "12:00", owner: "none" })).jobId;
    const bins = (await w.run(w.alex, "AddJob", { title: "Bins out", cadence: "weekly", startsOn: "2030-10-08", owner: "partner" })).jobId;
    // A family plan waiting for Sam, and Alex's swim needing Sam to have Mia.
    const both = [w.alex.accountId, w.sam.accountId];
    const park = await w.run(w.alex, "CreateMoment", { kind: "family", title: "Park and picnic", span: timed("2030-10-12", "11:00", "13:00"), participantIds: both, childIds: [mia] });
    await w.run(w.alex, "ShareMoment", { momentId: park.momentId, version: park.version });
    const swim = await w.run(w.alex, "CreateMoment", { kind: "me", title: "Pottery class", span: timed("2030-10-10", "19:00", "21:00"), participantIds: [w.alex.accountId], needsCare: true });
    await w.run(w.alex, "ShareMoment", { momentId: swim.momentId, version: swim.version });
    const ask = await w.run(w.alex, "ArrangeCare", { kind: "parent", responsibleAccountId: w.sam.accountId, childIds: [mia], span: timed("2030-10-10", "19:00", "21:00") });

    const alex = await review(w, w.alex);
    const sam = await review(w, w.sam);

    // Sam answers their own: the job ask, the plan, the care ask.
    expect(sam.groups.mine.map((i) => [i.kind, i.status])).toEqual([
      ["job", "You've been asked to take this on"],
      ["care", "Asked of you, not yet answered"],
      ["plan", "Waiting for your answer"],
    ]);
    // Alex sees the same records as waiting on Sam, each in its own words.
    expect(alex.groups.others.map((i) => [i.kind, i.status])).toEqual([
      ["job", "Asked Sam, not yet accepted"],
      ["care", "Asked, not yet confirmed"],
      ["plan", "Proposed, waiting for Sam"],
    ]);
    // The deadline belongs to either of them, with its cut-off, and nothing can wave it away.
    for (const v of [alex, sam]) {
      const d = v.groups.either.find((i) => i.targetId === form)!;
      expect(d).toMatchObject({ kind: "deadline", text: "Trip consent form: due by 12:00", date: "2030-10-09", status: "Nobody has taken this on" });
      expect(d.actions).toEqual(["take-it", "ask-partner"]);
    }
    // Asked care is not cover: the gap stays, saying someone has been asked.
    const gap = alex.groups.either.find((i) => i.kind === "care-gap")!;
    expect(gap.status).toBe("Someone has been asked; not covered until they say yes");
    expect(alex.groups.mine).toEqual([]);

    // Each answer saves on its own; nothing waits on sending new plans.
    const samJobs = await jobsFor(w.db, w.sam, NOW);
    await w.run(w.sam, "AnswerJobOwner", { jobId: bins, version: samJobs.jobs.find((j) => j.id === bins)!.version, accept: true });
    await w.run(w.sam, "RespondToMoment", { momentId: park.momentId, materialVersion: 1, decision: "accepted" });
    await w.run(w.sam, "RespondToCare", { arrangementId: ask.arrangementId, version: 1, decision: "confirm" });
    await w.run(w.alex, "ProposeJobOwner", { jobId: form, version: 1, to: "partner" });

    const after = await review(w, w.alex);
    // Only the deadline remains, now asked of Sam and still not agreed.
    expect(after.items.map((i) => [i.kind, i.status])).toEqual([["deadline", "Asked Sam, not yet accepted"]]);
    const samAfter = await review(w, w.sam);
    expect(samAfter.groups.mine.map((i) => [i.kind, i.actions])).toEqual([["deadline", ["answer-job"]]]);
    await w.run(w.sam, "AnswerJobOwner", { jobId: form, version: 2, accept: true });
    expect((await review(w, w.alex)).items.map((i) => i.status)).toEqual(["Sam has agreed to do this"]);
    expect((await review(w, w.sam)).items.map((i) => [i.status, i.actions])).toEqual([["Yours", ["mark-done"]]]);
  });

  it("keeps For Us, private plans, journal and check-in notes out of the shared review", async () => {
    const w = await newWorld();
    const { mia } = await family(w);
    const both = [w.alex.accountId, w.sam.accountId];
    // A couple invitation Alex chose to send: answerable on Today and For Us, never in the weekly review.
    const us = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Anniversary at Luca's", span: timed("2030-10-11", "19:00", "22:00"), participantIds: both, needsCare: true });
    await w.run(w.alex, "ShareMoment", { momentId: us.momentId, version: us.version });
    // Sam's private draft and private time, and private words.
    await w.run(w.sam, "CreateMoment", { kind: "family", title: "Secret birthday trip", span: timed("2030-10-12", "10:00", "16:00"), participantIds: both, childIds: [mia] });
    const me = await w.run(w.sam, "CreateMoment", { kind: "me", title: "Therapy session", span: timed("2030-10-09", "18:00", "19:00"), participantIds: [w.sam.accountId], needsCare: true });
    await w.run(w.sam, "ShareMoment", { momentId: me.momentId, version: me.version });
    await w.run(w.sam, "SaveCheckin", { weekKey: "2030-09-30", energy: 1, wants: ["sleep", "couple time"], note: "running on empty" });

    const alex = await review(w, w.alex);
    const sam = await review(w, w.sam);
    const alexDump = JSON.stringify(alex.items);
    for (const secret of ["Anniversary", "Luca", "Secret birthday", "Therapy", "running on empty", "couple"]) expect(alexDump).not.toContain(secret);
    expect(JSON.stringify(sam.items)).not.toContain("Anniversary");
    expect(sam.items.some((i) => i.targetId === us.momentId)).toBe(false);
    // Sam's time still needs care, and Alex sees that need without the reason behind it.
    const gap = alex.items.find((i) => i.kind === "care-gap" && i.date === "2030-10-09")!;
    expect(gap.text).toBe("Mia needs care (Sam has time to themselves)");
    // The couple's plan still needs cover for Mia, shown without what it is.
    expect(alex.items.find((i) => i.kind === "care-gap" && i.date === "2030-10-11")!.text).toBe("Mia needs care (you're both out)");
    // The invitation is still waiting for Sam where it always was.
    expect((await w.week(w.sam, "2030-10-07", NOW)).attention.some((a) => a.action === "respond" && a.targetId === us.momentId)).toBe(true);
  });

  it("lets the weekly review finish with no new Me or Family plans", async () => {
    const w = await newWorld();
    await family(w);
    const before = (await w.week(w.alex, "2030-10-07", NOW)).planning;
    expect(before.planned).toBe(false);
    const res = await w.run(w.alex, "PlanWeek", { weekKey: "2030-10-07", items: [] });
    expect(res.momentIds).toEqual([]);
    const count = async (q: ReturnType<typeof sql>) => ((await w.db.execute(q)) as unknown as { rows: { n: number }[] }).rows[0].n;
    expect(await count(sql`select count(*)::int as n from moments`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from notifications where kind like 'moment%'`)).toBe(0);
    expect(await count(sql`select items as n from week_plans where week_key = '2030-10-07'`)).toBe(0);
    // The week counts as planned, so the Sunday nudge goes for both adults.
    for (const who of [w.alex, w.sam]) {
      const week = await w.week(who, "2030-10-07", NOW);
      expect(week.planning).toEqual({ weekKey: "2030-10-07", planned: true });
      expect(week.attention.some((a) => a.action === "plan-week")).toBe(false);
    }
  });

  it("shows a clash on an agreed plan to the person who can move it, without another person's private title", async () => {
    const w = await newWorld();
    const { mia } = await family(w);
    const both = [w.alex.accountId, w.sam.accountId];
    const swim = await w.run(w.alex, "CreateMoment", { kind: "family", title: "Family swim", span: timed("2030-10-12", "10:00", "12:00"), participantIds: both, childIds: [mia] });
    await w.run(w.alex, "ShareMoment", { momentId: swim.momentId, version: swim.version });
    await w.run(w.sam, "RespondToMoment", { momentId: swim.momentId, materialVersion: 1, decision: "accepted" });
    // Sam later adds something private to their diary over it.
    await w.run(w.sam, "AddEvent", { title: "Job interview prep", visibility: "busy_only", span: timed("2030-10-12", "11:00", "12:30"), adultIds: [w.sam.accountId] });

    const alex = await review(w, w.alex);
    const clash = alex.items.find((i) => i.kind === "clash");
    expect(clash).toBeDefined();
    expect(clash!.waitingOn).toEqual({ kind: "me" });
    expect(clash!.status).toBe("Agreed, but something now overlaps it");
    expect(JSON.stringify(alex.items)).not.toContain("interview");
  });
});

describe("check-in wants stay with their owner and their week", () => {
  it("changes only the author's own picks, and only for the week it was given", async () => {
    const { picksFor } = await import("@/server/queries/picks");
    const w = await newWorld();
    const at = new Date("2030-10-08T08:00:00Z");
    const keys = async (who: Actor, now = at) => (await picksFor(w.db, who, "me", now, { count: 3 })).picks.map((p) => p.activity.key);
    const samBefore = await keys(w.sam);
    const alexBefore = await keys(w.alex);
    await w.run(w.alex, "SaveCheckin", { weekKey: "2030-10-07", wants: ["sleep"] });
    const alexAfter = await keys(w.alex);
    expect(["me-lie-in", "me-nothing", "me-bath"]).toContain(alexAfter[0]);
    expect(alexBefore.length).toBe(3);
    // Sam's suggestions are untouched by Alex's private answer.
    expect(await keys(w.sam)).toEqual(samBefore);
    // Next week the wish no longer applies unless Alex says it again.
    const nextWeek = new Date("2030-10-15T08:00:00Z");
    const withWish = await keys(w.alex, nextWeek);
    await w.db.execute(sql`delete from checkins`);
    expect(await keys(w.alex, nextWeek)).toEqual(withWish);
  });
});
