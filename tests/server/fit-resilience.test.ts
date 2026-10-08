import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { weekSpend } from "@/domain/money";
import { freeTimesFor, freeTogetherIn } from "@/server/queries/free-time";
import { easyDinnerOffers, mealsFor } from "@/server/queries/meals";
import { expectCode, newWorld, timed, type World } from "./harness";

// Monday 7 October 2030, 08:00 in London.
const NOW = new Date("2030-10-07T07:00:00Z");
const MON = "2030-10-07";
const TUE = "2030-10-08";
const WED = "2030-10-09";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const rows = async <T,>(w: World, q: ReturnType<typeof sql>) => ((await w.db.execute(q)) as unknown as { rows: T[] }).rows;

describe("the household's own evening (routine-aware suggestions)", () => {
  it("ends family suggestions when the household says, and starts couple evenings after bedtime without counting it as care", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    const lateWeekday = (slots: { date: string; endTime: string }[]) => slots.filter((s) => s.date <= "2030-10-11" && s.endTime > "17:00");
    // Out of the box: family time can run to 19:30 on a school night.
    expect(lateWeekday((await freeTimesFor(w.db, w.alex, "family", 60, NOW, 5)).slots).length).toBeGreaterThan(0);
    await w.run(w.alex, "SetEveningTimes", { eveningEnds: "17:00", bedtime: "20:00" });
    expect(lateWeekday((await freeTimesFor(w.db, w.alex, "family", 60, NOW, 5)).slots)).toEqual([]);

    const week = await w.week(w.alex, MON, NOW);
    const evenings = await freeTogetherIn(w.db, w.alex, week, NOW);
    expect(Object.values(evenings).every((e) => e.startTime >= "20:00")).toBe(true);
    // A bedtime is not someone looking after Mia.
    expect(Object.values(evenings).every((e) => e.care === "needs_care")).toBe(true);
    await expectCode(w.run(w.alex, "SetEveningTimes", { eveningEnds: "09:00", bedtime: null }), "VALIDATION");
  });

  it("offers an easy dinner on a hard evening, saying why in plain words, never naming a partner's private time", async () => {
    const w = await newWorld();
    const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId;
    const pie = (await w.run(w.alex, "SaveMeal", { name: "Fish pie", ingredients: ["Fish"] })).mealId;
    // Sam's late shift, kept as busy only; Mia's football, shared.
    await w.run(w.sam, "AddEvent", { title: "Night shift handover", visibility: "busy_only", span: timed(TUE, "09:00", "19:00"), adultIds: [w.sam.accountId] });
    await w.run(w.alex, "AddEvent", { title: "Football", visibility: "shared", span: timed(TUE, "17:00", "18:00"), adultIds: [], childIds: [mia] });
    await w.run(w.alex, "SetDinner", { date: TUE, choice: "meal", mealId: pie });
    const offers = async () => easyDinnerOffers(await w.week(w.alex, MON, NOW), await mealsFor(w.db, w.alex, MON, 7, NOW));

    // No quick meal saved: nothing to offer, so nothing is said.
    expect(await offers()).toEqual({});
    const toast = (await w.run(w.alex, "SaveMeal", { name: "Beans on toast", quick: true })).mealId;
    const got = await offers();
    expect(got).toEqual({ [TUE]: "A late finish and Football" });
    expect(JSON.stringify(got)).not.toContain("shift");
    // Already easy: no offer.
    await w.run(w.alex, "SetDinner", { date: TUE, version: 1, choice: "fallback", mealId: toast });
    expect(await offers()).toEqual({});
  });
});

describe("an advisory spending guide", () => {
  it("counts each cost once at its firmest figure, keeps unknown apart from free, and leaves out private budgets", async () => {
    expect(
      weekSpend([
        { estimateMinor: 3000, committedMinor: null, netPaidMinor: 0, remainingMinor: null }, // a guess
        { estimateMinor: 5000, committedMinor: 4000, netPaidMinor: 1000, remainingMinor: 3000 }, // agreed, part paid
        { estimateMinor: 2000, committedMinor: null, netPaidMinor: 2500, remainingMinor: null }, // paid more than guessed
        { estimateMinor: null, committedMinor: null, netPaidMinor: 0, remainingMinor: null }, // no figure at all
        { estimateMinor: 0, committedMinor: null, netPaidMinor: 0, remainingMinor: null }, // known to be free
      ]),
    ).toEqual({ paidMinor: 3500, toPayMinor: 3000, estimatedMinor: 3000, knownMinor: 9500, unknownCosts: 1 });

    const w = await newWorld();
    await w.run(w.alex, "SetSpendingGuide", { weeklyGuideMinor: 10000 });
    const both = [w.alex.accountId, w.sam.accountId];
    // Sam's private draft with a budget and an estimate: not in what Alex sees.
    const secret = await w.run(w.sam, "CreateMoment", { kind: "family", title: "Secret trip", span: timed(WED, "10:00", "16:00"), participantIds: both, budgetMinor: 25000 });
    await w.run(w.sam, "AddExpense", { label: "Trip", sourceType: "moment", sourceId: secret.momentId, estimateMinor: 20000 });
    // A shared cost both of them see does count.
    await w.run(w.alex, "AddExpense", { label: "Swimming", activityDate: TUE, committedMinor: 1200 });
    expect(weekSpend((await w.week(w.sam, MON, NOW)).expenses).knownMinor).toBe(21200);
    const alexWeek = await w.week(w.alex, MON, NOW);
    expect(alexWeek.household.weeklyGuideMinor).toBe(10000);
    expect(weekSpend(alexWeek.expenses).knownMinor).toBe(1200);
    expect(JSON.stringify(alexWeek)).not.toContain("25000");
  });
});

describe("recovery when something changes", () => {
  async function agreedSwim(w: World) {
    const both = [w.alex.accountId, w.sam.accountId];
    const swim = await w.run(w.alex, "CreateMoment", { kind: "family", title: "Woodland walk", activityKey: "fam-woodland-walk", span: timed("2030-10-12", "10:00", "12:00"), participantIds: both });
    await w.run(w.alex, "ShareMoment", { momentId: swim.momentId, version: swim.version });
    await w.run(w.sam, "RespondToMoment", { momentId: swim.momentId, materialVersion: 1, decision: "accepted" });
    const m = (await w.week(w.alex, "2030-10-07", NOW)).moments.find((x) => x.id === swim.momentId)!;
    return m;
  }

  it("moves an agreed plan only by asking again, and rechecks the new time at the moment of saving", async () => {
    const w = await newWorld();
    const m = await agreedSwim(w);
    expect(m.stage).not.toBe("Waiting for answers");
    // Sam has just put something in the diary on Sunday morning.
    await w.run(w.sam, "AddEvent", { title: "Dentist", visibility: "busy_only", span: timed("2030-10-13", "09:00", "11:00"), adultIds: [w.sam.accountId] });
    await expectCode(w.run(w.alex, "MoveMoment", { momentId: m.id, version: m.version, span: timed("2030-10-13", "10:00", "12:00") }), "CONFLICT");
    // A stale screen can't move it either.
    await expectCode(w.run(w.alex, "MoveMoment", { momentId: m.id, version: m.version - 1, span: timed("2030-10-13", "14:00", "16:00") }), "STALE_VERSION");

    await w.run(w.alex, "MoveMoment", { momentId: m.id, version: m.version, span: timed("2030-10-13", "14:00", "16:00") });
    const sam = (await w.week(w.sam, "2030-10-07", NOW)).moments.find((x) => x.id === m.id)!;
    expect(sam.myDecision).toBeNull();
    expect(sam.lifecycle).toBe("planned");
    // Nothing is held in Sam's diary until Sam says yes to the new time.
    expect(await rows(w, sql`select account_id from reservations where source_id = ${m.id}`)).toEqual([]);
    const asked = await rows<{ recipient: string }>(w, sql`select payload->>'recipientId' as recipient from outbox where payload->>'kind' = 'moment.changed'`);
    expect(asked.map((r) => r.recipient)).toEqual([w.sam.accountId]);
  });

  it("keeps the time with a simpler version, tells the others, and leaves the couple's plans to whoever made them", async () => {
    const w = await newWorld();
    const m = await agreedSwim(w);
    await w.run(w.alex, "SwapActivity", { momentId: m.id, version: m.version, title: "Twenty minutes in the nearest park", activityKey: null, location: "", reason: "simpler" });
    const sam = (await w.week(w.sam, "2030-10-07", NOW)).moments.find((x) => x.id === m.id)!;
    expect(sam).toMatchObject({ title: "Twenty minutes in the nearest park", myDecision: "accepted" });
    const told = await rows<{ text: string }>(w, sql`select payload->>'text' as text from outbox where payload->>'kind' = 'moment.swapped'`);
    expect(told.map((t) => t.text)).toEqual(["Alex kept the time and made it simpler: Twenty minutes in the nearest park instead of Woodland walk."]);

    const both = [w.alex.accountId, w.sam.accountId];
    const us = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Dinner out", span: timed("2030-10-11", "19:00", "21:00"), participantIds: both });
    await w.run(w.alex, "ShareMoment", { momentId: us.momentId, version: us.version });
    await expectCode(w.run(w.sam, "MoveMoment", { momentId: us.momentId, version: 2, span: timed("2030-10-11", "20:00", "22:00") }), "VALIDATION");
  });

  it("shows time you gave up to you alone, never to your partner", async () => {
    const w = await newWorld();
    const me = await w.run(w.sam, "CreateMoment", { kind: "me", title: "Pottery class", span: timed("2030-10-09", "19:00", "21:00"), participantIds: [w.sam.accountId] });
    await w.run(w.sam, "ShareMoment", { momentId: me.momentId, version: me.version });
    await w.run(w.sam, "CancelMoment", { momentId: me.momentId, version: 2 });
    const mine = (await w.week(w.sam, "2030-10-07", NOW)).moments.find((x) => x.id === me.momentId)!;
    expect(mine).toMatchObject({ lifecycle: "cancelled", title: "Pottery class", organiserId: w.sam.accountId });
    expect(JSON.stringify(await w.week(w.alex, "2030-10-07", NOW))).not.toContain("Pottery");
  });
});
