import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { careArrangements, moments } from "@/db/schema";
import { answerAsk, askView } from "@/server/commands/village";
import { lookBackFor } from "@/server/queries/look-back";
import { picksFor } from "@/server/queries/picks";
import { topUpRituals } from "@/server/rituals";
import { weekKeyFor } from "@/domain/time";
import { expectCode, newWorld, timed } from "./harness";

const WEEK = "2030-10-07";

describe("rituals: plans that repeat", () => {
  it("starts once both agree, fills four weeks, survives a skip, and stops cleanly", async () => {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Robin", ageBand: "5-7" });
    const people = [w.alex.accountId, w.sam.accountId];
    const { ritualId } = await w.run(w.alex, "StartRitual", {
      kind: "family", title: "Friday pizza", participantIds: people, childIds: [childId], cadence: "weekly", startsOn: "2030-10-11", startTime: "18:00", durationMinutes: 90,
    });
    const now = new Date("2030-10-05T12:00:00Z");
    expect((await topUpRituals(w.db, now)).created).toBe(0); // Sam hasn't agreed yet

    let samWeek = await w.week(w.sam, WEEK, now);
    expect(samWeek.attention.some((a) => a.action === "ritual" && a.text.includes("Friday pizza"))).toBe(true);
    const r = samWeek.rituals[0];
    expect(r.label).toBe("Every Friday");
    await w.run(w.sam, "JoinRitual", { ritualId, version: r.version });
    expect((await topUpRituals(w.db, now)).created).toBe(4);
    expect((await topUpRituals(w.db, now)).created).toBe(0);

    samWeek = await w.week(w.sam, WEEK, now);
    const first = samWeek.moments.find((m) => m.ritualId === ritualId)!;
    expect(first.agreed).toBe(true);
    expect(first.title).toBe("Friday pizza");

    // Skip this week; it never comes back.
    await w.run(w.alex, "CancelMoment", { momentId: first.id, version: first.version });
    await topUpRituals(w.db, now);
    expect((await w.week(w.alex, WEEK, now)).moments.filter((m) => m.ritualId === ritualId && m.lifecycle !== "cancelled")).toHaveLength(0);

    const live = (await w.week(w.alex, WEEK, now)).rituals[0];
    await w.run(w.alex, "EndRitual", { ritualId, version: live.version });
    const later = await w.db.select().from(moments).where(eq(moments.ritualId, ritualId));
    expect(later.every((m) => m.lifecycle === "cancelled" || m.startAt.getTime() < Date.now())).toBe(true);
    expect((await w.week(w.alex, WEEK, now)).rituals).toHaveLength(0);
  });

  it("a date that clashes is flagged, not double-booked", async () => {
    const w = await newWorld();
    await w.run(w.sam, "AddEvent", { title: "Late shift", span: timed("2030-10-18", "17:00", "23:00"), adultIds: [w.sam.accountId] });
    const people = [w.alex.accountId, w.sam.accountId];
    const { ritualId } = await w.run(w.alex, "StartRitual", { kind: "us", title: "Date night", participantIds: people, cadence: "weekly", startsOn: "2030-10-11", startTime: "19:30", durationMinutes: 150 });
    const r = (await w.week(w.sam, WEEK)).rituals[0];
    await w.run(w.sam, "JoinRitual", { ritualId, version: r.version });
    await topUpRituals(w.db, new Date("2030-10-05T12:00:00Z"));
    const clash = (await w.week(w.alex, "2030-10-14")).moments.find((m) => m.ritualId === ritualId)!;
    expect(clash.review).toBe("needs_review");
    expect(clash.reviewReason).toMatch(/clashes/);
  });

  it("a partner's Me ritual shows only as time for themselves", async () => {
    const w = await newWorld();
    await w.run(w.sam, "StartRitual", { kind: "me", title: "Pottery class", participantIds: [w.sam.accountId], cadence: "weekly", startsOn: "2030-10-08", startTime: "19:00", durationMinutes: 120 });
    const alexView = await w.week(w.alex, WEEK);
    expect(JSON.stringify(alexView.rituals)).not.toContain("Pottery");
    expect(alexView.rituals[0].title).toBe("Sam: time for themselves");
  });
});

describe("highlights, the week plan and the look-back", () => {
  it("shares a one-line highlight with the people in the plan, never the private reflection", async () => {
    const w = await newWorld();
    const people = [w.alex.accountId, w.sam.accountId];
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const m = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Box Hill walk", span: timed(past, "10:00", "12:00"), participantIds: people });
    await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
    await w.run(w.sam, "RespondToMoment", { momentId: m.momentId, materialVersion: 1, decision: "accepted" });
    await expectCode(w.run(w.alex, "SaveHighlight", { momentId: m.momentId, text: "Too soon" }), "CONFLICT");
    let mv = (await w.week(w.alex, weekKeyFor(past))).moments[0];
    await w.run(w.alex, "CompleteMoment", { momentId: m.momentId, version: mv.version });
    await w.run(w.alex, "SaveFeedback", { momentId: m.momentId, enjoyed: false, note: "My knee hurt" });
    await w.run(w.alex, "SaveHighlight", { momentId: m.momentId, text: "The view from the top" });

    mv = (await w.week(w.sam, weekKeyFor(past))).moments[0];
    expect(mv.highlights).toEqual([{ authorId: w.alex.accountId, authorName: "Alex", text: "The view from the top", mine: false }]);
    expect(JSON.stringify(await w.week(w.sam, weekKeyFor(past)))).not.toContain("knee");

    const month = past.slice(0, 7);
    const lb = await lookBackFor(w.db, w.sam, month);
    expect(lb.counts.us).toBe(1);
    expect(lb.moments[0].highlights[0].text).toBe("The view from the top");
  });

  it("sends a week's plans to the partner in one go and marks the week planned", async () => {
    const w = await newWorld();
    const people = [w.alex.accountId, w.sam.accountId];
    const items = [
      { kind: "us", title: "Dinner", span: timed("2030-10-11", "19:30", "22:00"), participantIds: people },
      { kind: "me", title: "Swim", span: timed("2030-10-12", "08:00", "09:30"), participantIds: [w.alex.accountId] },
    ];
    const { momentIds } = await w.run(w.alex, "PlanWeek", { weekKey: WEEK, items });
    expect(momentIds).toHaveLength(2);
    const sam = await w.week(w.sam, WEEK, new Date("2030-10-05T12:00:00Z"));
    expect(sam.attention.filter((a) => a.action === "respond")).toHaveLength(1);
    expect(sam.moments.find((m) => m.momentKind === "me")!.title).toBe("Alex: time for themselves");
    expect(sam.planning).toEqual({ weekKey: WEEK, planned: true });
    expect(sam.attention.some((a) => a.action === "plan-week")).toBe(false);
  });

  it("records whose pick a family plan was, and one-to-one time per adult and child", async () => {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Robin", ageBand: "8-11" });
    await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const m = await w.run(w.alex, "CreateMoment", { kind: "family", title: "Climbing wall", span: timed(past, "10:00", "11:00"), participantIds: [w.alex.accountId], childIds: [childId], chosenByChildId: childId });
    await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
    const mv = (await w.week(w.alex, weekKeyFor(past))).moments[0];
    expect(mv.chosenByChildId).toBe(childId);
    await w.run(w.alex, "CompleteMoment", { momentId: m.momentId, version: mv.version });
    const lb = await lookBackFor(w.db, w.sam, past.slice(0, 7));
    expect(lb.moments[0].chosenBy).toBe("Robin");
    expect(lb.oneToOne.find((p) => p.adultName === "Alex" && p.childName === "Robin")!.lastDate).toBe(past);
    expect(lb.oneToOne.find((p) => p.adultName === "Sam" && p.childName === "Robin")!.lastDate).toBeNull();
  });
});

describe("the village and picks", () => {
  it("asks a saved helper by link; their yes covers the gap and tells both adults", async () => {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Robin", ageBand: "5-7" });
    const { helperId } = await w.run(w.alex, "AddHelper", { name: "Gran", relation: "Grandparent", phone: "+44 7700 900123" });
    const ask = await w.run(w.alex, "AskHelper", { helperId, childIds: [childId], span: timed("2030-10-11", "18:30", "23:00") });
    expect(ask.phone).toBe("+44 7700 900123");

    const view = (await askView(w.db, ask.token))!;
    expect(view).toMatchObject({ askerName: "Alex", childNames: ["Robin"], open: true, response: null });
    expect(JSON.stringify(view)).not.toMatch(/Reynolds|Sam/);
    expect(await askView(w.db, "not-a-real-token")).toBeNull();

    await answerAsk(w.db, ask.token, "yes");
    const [a] = await w.db.select().from(careArrangements).where(eq(careArrangements.id, ask.arrangementId));
    expect(a.state).toBe("confirmed");
    expect(a.providerName).toBe("Gran");
    // A second answer changes nothing.
    expect((await answerAsk(w.db, ask.token, "no"))!.response).toBe("yes");
    const sam = await w.week(w.sam, WEEK);
    expect(sam.helpers.map((h) => h.name)).toEqual(["Gran"]);
  });

  it("gives three different picks for the week, each with a time and who covers the children", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddChild", { preferredName: "Robin", ageBand: "5-7" });
    await w.run(w.alex, "AddHelper", { name: "Gran" });
    const res = await picksFor(w.db, w.alex, "us", new Date("2030-10-05T09:00:00Z"));
    expect(res.picks).toHaveLength(3);
    expect(new Set(res.picks.map((p) => p.activity.category)).size).toBe(3);
    expect(res.picks.every((p) => p.slot)).toBe(true);
    expect(new Set(res.picks.map((p) => p.slot!.date)).size).toBe(3);
    expect(res.picks.every((p) => p.carer.kind === "helper" && p.carer.name === "Gran")).toBe(true);
  });
});
