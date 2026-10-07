import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { careArrangements, notifications, reservations } from "@/db/schema";
import { CATALOGUE } from "@/lib/catalogue";
import { freeTimesFor, freeTogetherIn } from "@/server/queries/free-time";
import { picksFor } from "@/server/queries/picks";
import type { Actor } from "@/server/auth";
import { processOutbox } from "@/server/outbox";
import { expectCode, newWorld, timed } from "./harness";

const WEEK = "2030-10-07"; // Monday, BST
const BEFORE = new Date("2030-10-06T12:00:00Z");
const days = (week: string) => Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${week}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

describe("R05 free-together evenings are facts, not a shortlist (BR-09)", () => {
  it("an empty week shows seven free evenings", async () => {
    const w = await newWorld();
    const free = await freeTogetherIn(w.db, w.alex, await w.week(w.alex, WEEK, BEFORE), BEFORE);
    expect(Object.keys(free).sort()).toEqual(days(WEEK));
    expect(Object.values(free).every((f) => f.startTime === "18:30")).toBe(true);
  });

  it("blocking one evening removes only that evening", async () => {
    const w = await newWorld();
    await w.run(w.sam, "AddEvent", { title: "Choir", span: timed("2030-10-09", "18:00", "22:30"), adultIds: [w.sam.accountId] });
    const free = await freeTogetherIn(w.db, w.alex, await w.week(w.alex, WEEK, BEFORE), BEFORE);
    expect(Object.keys(free).sort()).toEqual(days(WEEK).filter((d) => d !== "2030-10-09"));
  });

  it("a late finish moves that evening's start, it doesn't drop it", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddEvent", { title: "Work", span: timed("2030-10-10", "09:00", "19:30"), adultIds: [w.alex.accountId] });
    const free = await freeTogetherIn(w.db, w.alex, await w.week(w.alex, WEEK, BEFORE), BEFORE);
    expect(free["2030-10-10"].startTime).toBe("19:30");
  });

  it("the week the clocks go back still has seven evenings", async () => {
    const w = await newWorld();
    const before = new Date("2030-10-20T12:00:00Z");
    const free = await freeTogetherIn(w.db, w.alex, await w.week(w.alex, "2030-10-21", before), before);
    expect(Object.keys(free).sort()).toEqual(days("2030-10-21"));
    expect(free["2030-10-27"].startTime).toBe("18:30");
  });
});

describe("R06 care already arranged shows in suggestions (BR-10)", () => {
  async function fourChildren() {
    const w = await newWorld();
    const kids: string[] = [];
    for (const name of ["Ada", "Ben", "Cal", "Dot"]) kids.push((await w.run(w.alex, "AddChild", { preferredName: name, ageBand: "5-7" })).childId);
    return { w, kids };
  }
  const friday = async (w: Awaited<ReturnType<typeof newWorld>>) => (await freeTogetherIn(w.db, w.alex, await w.week(w.alex, WEEK, BEFORE), BEFORE))["2030-10-11"];

  it("needs care when nothing is arranged", async () => {
    const { w } = await fourChildren();
    expect((await friday(w)).care).toBe("needs_care");
  });

  it("full external cover reads as arranged; one child with a gap keeps it visible", async () => {
    const { w, kids } = await fourChildren();
    await w.run(w.alex, "ArrangeCare", { kind: "external", providerName: "Nana", childIds: kids, span: timed("2030-10-11", "18:00", "23:30"), confirmed: true });
    expect((await friday(w)).care).toBe("arranged");

    const b = await fourChildren();
    await b.w.run(b.w.alex, "ArrangeCare", { kind: "external", providerName: "Nana", childIds: b.kids.slice(0, 3), span: timed("2030-10-11", "18:00", "23:30"), confirmed: true });
    await b.w.run(b.w.alex, "ArrangeCare", { kind: "external", providerName: "Club", childIds: [b.kids[3]], span: timed("2030-10-11", "18:00", "20:50"), confirmed: true });
    expect((await friday(b.w)).care).toBe("partly_arranged");
  });

  it("asked but not yet confirmed reads as pending; withdrawn cover goes back to needing care", async () => {
    const { w, kids } = await fourChildren();
    const { arrangementId } = await w.run(w.alex, "ArrangeCare", { kind: "external", providerName: "Nana", childIds: kids, span: timed("2030-10-11", "18:00", "23:30") });
    expect((await friday(w)).care).toBe("pending");
    const [arr] = await w.db.select().from(careArrangements).where(eq(careArrangements.id, arrangementId));
    await w.run(w.alex, "RemoveCare", { arrangementId, version: arr.version });
    expect((await friday(w)).care).toBe("needs_care");
  });

  it("a free partner is a possible carer for Me time, not confirmed care", async () => {
    const { w, kids } = await fourChildren();
    const me = await freeTimesFor(w.db, w.alex, "me", 60, BEFORE, 7);
    expect(me.slots.every((s) => s.care === "partner_free" || s.care === "needs_care")).toBe(true);
    await w.run(w.alex, "ArrangeCare", { kind: "external", providerName: "Club", childIds: kids, span: timed("2030-10-12", "08:00", "13:00"), confirmed: true });
    const after = await freeTimesFor(w.db, w.alex, "me", 60, BEFORE, 7);
    const saturdayMorning = after.slots.find((s) => s.date === "2030-10-12" && s.startTime >= "08:00" && s.endTime <= "13:00");
    if (saturdayMorning) expect(saturdayMorning.care).toBe("arranged");
  });
});

describe("R07 each partner's shelf is dealt on the server (BR-12)", () => {
  const usKeys = CATALOGUE.filter((a) => a.kind === "us").map((a) => a.key);

  it("the two shelves split every idea, and an idea a partner has used moves to their shelf only", async () => {
    const w = await newWorld();
    const alexShelf = (await w.week(w.alex, WEEK, BEFORE)).usShelf!;
    const samShelf = (await w.week(w.sam, WEEK, BEFORE)).usShelf!;
    expect(alexShelf.filter((k) => samShelf.includes(k))).toEqual([]);
    expect([...alexShelf, ...samShelf].sort()).toEqual([...usKeys].sort());

    // Sam plans (privately) an idea that was dealt to Alex.
    const taken = alexShelf[0];
    await w.run(w.sam, "CreateMoment", { kind: "us", title: "Our evening", activityKey: taken, span: timed("2030-10-11", "19:00", "21:00"), participantIds: [w.sam.accountId, w.alex.accountId] });
    const alexAfter = (await w.week(w.alex, WEEK, BEFORE)).usShelf!;
    const samAfter = (await w.week(w.sam, WEEK, BEFORE)).usShelf!;
    expect(alexAfter).not.toContain(taken);
    expect(samAfter).toContain(taken);
    // Nothing else moved.
    expect(alexAfter).toEqual(alexShelf.filter((k) => k !== taken));
    // Alex's browser is never told which idea Sam used.
    expect(JSON.stringify(await w.week(w.alex, WEEK, BEFORE))).not.toContain(taken);
    // And Alex's suggestions never offer it.
    for (let i = 0; i < 4; i++) {
      const picks = await picksFor(w.db, w.alex, "us", new Date(BEFORE.getTime() + i * 7 * 86_400_000), { count: 6 });
      expect(picks.picks.map((p) => p.activity.key)).not.toContain(taken);
    }
  });
});

describe("R08 the named parent can look again at care they promised (BR-11)", () => {
  // Sam has an evening to themselves on Wednesday; Alex said they'd have the children.
  async function promised() {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Ada", ageBand: "5-7" });
    const { momentId } = await w.run(w.sam, "CreateMoment", { kind: "me", title: "Pottery class", span: timed("2030-10-09", "18:00", "21:00"), participantIds: [w.sam.accountId], needsCare: true });
    await w.run(w.sam, "AddEvent", { title: "Pottery class", span: timed("2030-10-09", "18:00", "21:00"), adultIds: [w.sam.accountId] });
    const { arrangementId } = await w.run(w.alex, "ArrangeCare", { kind: "parent", responsibleAccountId: w.alex.accountId, childIds: [childId], span: timed("2030-10-09", "17:30", "21:30") });
    const arr = async (id = arrangementId) => (await w.db.select().from(careArrangements).where(eq(careArrangements.id, id)))[0];
    const samPlan = async () => (await w.week(w.sam, WEEK, BEFORE)).moments.find((m) => m.id === momentId)!;
    const told = async (who: Actor) => {
      await processOutbox(w.db);
      return (await w.db.select().from(notifications).where(eq(notifications.accountId, who.accountId))).map((n) => ({ kind: n.kind, text: n.text }));
    };
    return { w, childId, arrangementId, arr, samPlan, told };
  }

  it("only the parent who promised sees the choice, and only for care still ahead", async () => {
    const { w, arrangementId, arr } = await promised();
    expect((await w.week(w.alex, WEEK, BEFORE)).carePromisedByMe.map((a) => a.id)).toEqual([arrangementId]);
    expect((await w.week(w.sam, WEEK, BEFORE)).carePromisedByMe).toEqual([]);
    // Once it's over, there's nothing to review.
    expect((await w.week(w.alex, WEEK, new Date("2030-10-10T12:00:00Z"))).carePromisedByMe).toEqual([]);
    await expectCode(w.run(w.sam, "ReviewCare", { arrangementId, version: (await arr()).version, choice: "withdraw" }), "FORBIDDEN");
  });

  it("keeping it changes nothing and tells nobody", async () => {
    const { w, arrangementId, arr, samPlan, told } = await promised();
    const before = await arr();
    await w.run(w.alex, "ReviewCare", { arrangementId, version: before.version, choice: "keep" });
    expect((await arr()).version).toBe(before.version);
    expect((await samPlan()).careState).toBe("covered");
    expect((await told(w.sam)).filter((n) => n.kind.startsWith("care."))).toEqual([]);
  });

  it("handing over keeps the children covered until the other adult says yes, then moves the promise", async () => {
    const { w, arrangementId, arr, samPlan, told } = await promised();
    const { replacementId } = await w.run(w.alex, "ReviewCare", { arrangementId, version: (await arr()).version, choice: "hand_over" });
    // Still Alex's until Sam answers.
    expect((await arr()).state).toBe("confirmed");
    expect((await samPlan()).careState).toBe("covered");
    const asks = await told(w.sam);
    expect(asks).toEqual([{ kind: "care.asked", text: expect.stringMatching(/^Alex asked if you can look after the children instead, Wed 9 Oct, 17:30\.$/) }]);
    expect((await w.week(w.sam, WEEK, BEFORE)).careAwaitingMe.map((a) => a.id)).toEqual([replacementId]);

    // But Sam is the one with the pottery class: saying yes clashes, and Alex keeps it.
    await expectCode(w.run(w.sam, "RespondToCare", { arrangementId: replacementId, version: (await arr(replacementId)).version, decision: "confirm" }), "CONFLICT");
    await w.run(w.sam, "RespondToCare", { arrangementId: replacementId, version: (await arr(replacementId)).version, decision: "decline" });
    expect((await arr()).state).toBe("confirmed");
    expect((await told(w.alex)).map((n) => n.text)).toContainEqual(expect.stringMatching(/^Sam can't take over looking after the children, .+\. You're still down for it\.$/));
  });

  it("a yes from the other adult retires the original promise and frees the first parent", async () => {
    const { w, childId, arr, told } = await promised();
    // A Saturday Alex has promised, which Sam is free for.
    const { arrangementId } = await w.run(w.alex, "ArrangeCare", { kind: "parent", responsibleAccountId: w.alex.accountId, childIds: [childId], span: timed("2030-10-12", "10:00", "12:00") });
    const { replacementId } = await w.run(w.alex, "ReviewCare", { arrangementId, version: (await arr(arrangementId)).version, choice: "hand_over" });
    await w.run(w.sam, "RespondToCare", { arrangementId: replacementId, version: (await arr(replacementId)).version, decision: "confirm" });
    expect((await arr(arrangementId)).state).toBe("declined");
    expect((await arr(replacementId)).state).toBe("confirmed");
    const reserved = await w.db.select().from(reservations).where(eq(reservations.sourceId, arrangementId));
    expect(reserved).toEqual([]);
    expect((await told(w.alex)).map((n) => n.kind)).toContain("care.taken_over");
    // Alex is free that morning again; Sam is now busy with the children.
    const alexFree = await freeTimesFor(w.db, w.alex, "me", 60, BEFORE, 7);
    expect(alexFree.slots.some((s) => s.date === "2030-10-12" && s.startTime >= "10:00" && s.endTime <= "12:00")).toBe(true);
  });

  it("withdrawing shows the gap again everywhere and tells the other adult, without any reason", async () => {
    const { w, arrangementId, arr, samPlan, told } = await promised();
    await w.run(w.alex, "SaveCheckin", { weekKey: WEEK, energy: 1, pressure: 5, note: "Shattered, a private worry about work" });
    await w.run(w.alex, "ReviewCare", { arrangementId, version: (await arr()).version, choice: "withdraw" });
    expect((await arr()).state).toBe("declined");
    expect((await samPlan()).careState).toBe("unresolved");
    const news = await told(w.sam);
    expect(news.map((n) => n.text)).toEqual([expect.stringMatching(/^Alex can no longer look after the children, Wed 9 Oct, 17:30\. Care is needed again\.$/)]);
    expect(JSON.stringify(await w.week(w.sam, WEEK, BEFORE))).not.toMatch(/Shattered|worry/);
  });
});

describe("Named drop-off and collection", () => {
  async function club() {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Ada", ageBand: "5-7" });
    await w.run(w.alex, "CreateHoliday", { name: "Inset day", startDate: "2030-10-09", endDate: "2030-10-09", dailyStart: "09:00", dailyEnd: "15:30", childIds: [childId] });
    const { arrangementId } = await w.run(w.alex, "ArrangeCare", { kind: "external", providerName: "Holiday club", childIds: [childId], span: timed("2030-10-09", "09:00", "15:30"), confirmed: true });
    const arr = async () => (await w.db.select().from(careArrangements).where(eq(careArrangements.id, arrangementId)))[0];
    return { w, arrangementId, arr };
  }

  it("naming yourself agrees and reserves the journey; naming the other adult asks them", async () => {
    const { w, arrangementId, arr } = await club();
    await w.run(w.alex, "SetHandover", { arrangementId, version: (await arr()).version, leg: "drop_off", accountId: w.alex.accountId });
    await w.run(w.alex, "SetHandover", { arrangementId, version: (await arr()).version, leg: "collect", accountId: w.sam.accountId });
    const a = await arr();
    expect([a.dropOffBy, a.dropOffAgreed, a.collectBy, a.collectAgreed]).toEqual([w.alex.accountId, true, w.sam.accountId, false]);
    const view = (await w.week(w.alex, WEEK, BEFORE)).care[0].groups[0].arrangements[0];
    expect(view.dropOff).toEqual({ by: w.alex.accountId, agreed: true });
    expect(view.collect).toEqual({ by: w.sam.accountId, agreed: false });
    const samWeek = await w.week(w.sam, WEEK, BEFORE);
    expect(samWeek.handoversAwaitingMe.map((h) => h.leg)).toEqual(["collect"]);
    expect(samWeek.attention.some((i) => i.text === "Can you do the collection for Ada?")).toBe(true);
    // Alex's morning is held for the drop-off (20 minutes each way).
    const held = await w.db.select().from(reservations).where(eq(reservations.sourceId, arrangementId));
    expect(held.map((r) => [r.sourceType, r.accountId, r.endAt.getTime() - r.startAt.getTime()])).toEqual([["drop_off", w.alex.accountId, 40 * 60_000]]);
  });

  it("the asked adult agrees or declines; declining reopens it and tells the others", async () => {
    const { w, arrangementId, arr } = await club();
    await w.run(w.alex, "SetHandover", { arrangementId, version: (await arr()).version, leg: "collect", accountId: w.sam.accountId });
    await expectCode(w.run(w.alex, "RespondToHandover", { arrangementId, version: (await arr()).version, leg: "collect", decision: "agree" }), "FORBIDDEN");
    await w.run(w.sam, "RespondToHandover", { arrangementId, version: (await arr()).version, leg: "collect", decision: "decline" });
    expect([(await arr()).collectBy, (await arr()).collectAgreed]).toEqual([null, false]);
    await processOutbox(w.db);
    const toAlex = await w.db.select().from(notifications).where(eq(notifications.accountId, w.alex.accountId));
    expect(toAlex.map((n) => n.text)).toContainEqual(expect.stringMatching(/^Sam can't do the collection, Wed 9 Oct, 15:30\. Someone is still needed\.$/));

    await w.run(w.alex, "SetHandover", { arrangementId, version: (await arr()).version, leg: "collect", accountId: w.sam.accountId });
    await w.run(w.sam, "RespondToHandover", { arrangementId, version: (await arr()).version, leg: "collect", decision: "agree" });
    expect((await arr()).collectAgreed).toBe(true);
  });

  it("a collection clashes with other plans like anything else", async () => {
    const { w, arrangementId, arr } = await club();
    await w.run(w.sam, "AddEvent", { title: "Dentist", span: timed("2030-10-09", "15:00", "16:00"), adultIds: [w.sam.accountId] });
    await expectCode(w.run(w.sam, "SetHandover", { arrangementId, version: (await arr()).version, leg: "collect", accountId: w.sam.accountId }), "CONFLICT");
  });

  it("leaving the household hands their drop-offs and collections back", async () => {
    const { w, arrangementId, arr } = await club();
    await w.run(w.sam, "SetHandover", { arrangementId, version: (await arr()).version, leg: "collect", accountId: w.sam.accountId });
    await w.run(w.sam, "LeaveHousehold", { confirm: true });
    expect([(await arr()).collectBy, (await arr()).collectAgreed]).toEqual([null, false]);
    expect(await w.db.select().from(reservations).where(eq(reservations.sourceId, arrangementId))).toEqual([]);
  });
});
