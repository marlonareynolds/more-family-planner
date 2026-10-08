import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { jobsFor } from "@/server/queries/jobs";
import { mealsFor } from "@/server/queries/meals";
import { decisionsFor } from "@/server/queries/decisions";
import { reviewRange } from "@/server/queries/review-range";
import { getProjection } from "@/server/queries/week";
import { expectCode, newWorld, type World } from "./harness";

// Monday 5 October 2026, 08:00 in London.
const NOW = new Date("2026-10-05T07:00:00Z");
const MON = "2026-10-05";
const TUE = "2026-10-06";
const THU = "2026-10-08";

// Commands read the clock; hold it at Monday morning so "past" and "today" mean the same here.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function rows<T>(w: World, q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await w.db.execute(q)) as unknown as { rows: T[] }).rows;
}
const count = async (w: World, q: ReturnType<typeof sql>) => (await rows<{ n: number }>(w, q))[0].n;
const notices = (w: World, kind: string) => rows<{ recipient: string; text: string }>(w, sql`select payload->>'recipientId' as recipient, payload->>'text' as text from outbox where payload->>'kind' = ${kind} order by created_at`);

async function kitchen(w: World) {
  const pie = (await w.run(w.alex, "SaveMeal", { name: "Fish pie", ingredients: ["Fish", "Potatoes", "Milk", "milk "] })).mealId as string;
  const pasta = (await w.run(w.alex, "SaveMeal", { name: "Pasta bake", ingredients: ["Pasta", "Milk", "Cheese"] })).mealId as string;
  const toast = (await w.run(w.sam, "SaveMeal", { name: "Beans on toast", ingredients: ["Beans", "Bread"], quick: true })).mealId as string;
  return { pie, pasta, toast };
}

const view = (w: World, who = w.alex) => mealsFor(w.db, who, MON, 7, NOW);

describe("dinners and the shopping list (brief check 4)", () => {
  it("saves, reopens and changes a dinner without duplicating jobs or shopping lines", async () => {
    const w = await newWorld();
    const { pie, pasta } = await kitchen(w);
    const tue = (await w.run(w.alex, "SetDinner", { date: TUE, choice: "meal", mealId: pie })).dinnerId;
    // Saving the same thing again, from a stale screen or a double tap, changes nothing.
    expect((await w.run(w.alex, "SetDinner", { date: TUE, version: 1, choice: "meal", mealId: pie })).dinnerId).toBe(tue);
    await expectCode(w.run(w.sam, "SetDinner", { date: TUE, choice: "meal", mealId: pasta }), "STALE_VERSION");
    const cook = await w.run(w.alex, "DinnerJob", { dinnerId: tue, role: "cook", owner: "me" });
    const again = await w.run(w.alex, "DinnerJob", { dinnerId: tue, role: "cook", owner: "me" });
    expect(again).toEqual({ jobId: cook.jobId, existed: true });
    // Even the partner asking for the same part finds the one already there.
    expect((await w.run(w.sam, "DinnerJob", { dinnerId: tue, role: "cook", owner: "me" })).jobId).toBe(cook.jobId);

    let v = await view(w);
    expect(v.dinners).toHaveLength(1);
    expect(v.dinners[0]).toMatchObject({ date: TUE, label: "Fish pie", jobs: [{ role: "cook", ownerId: w.alex.accountId }] });
    // "Milk" typed twice in one meal is one line.
    expect(v.shopping.map((l) => l.name)).toEqual(["Fish", "Potatoes", "Milk"]);

    // Change the meal: the shopping follows, the cook keeps the job under its new name.
    await w.run(w.sam, "SetDinner", { date: TUE, version: 1, choice: "meal", mealId: pasta });
    v = await view(w);
    expect(v.shopping.map((l) => l.name).sort()).toEqual(["Cheese", "Milk", "Pasta"]);
    const jobs = (await jobsFor(w.db, w.alex, NOW)).jobs;
    expect(jobs.filter((j) => j.dinner?.id === tue).map((j) => [j.title, j.ownerId])).toEqual([["Dinner: cook Pasta bake", w.alex.accountId]]);
    expect((await notices(w, "job.changed")).map((n) => n.recipient)).toEqual([w.alex.accountId]);
    expect(await count(w, sql`select count(*)::int as n from jobs where for_id = ${tue}`)).toBe(1);
  });

  it("removing one dinner keeps another dinner's ingredients and anything added by hand", async () => {
    const w = await newWorld();
    const { pie, pasta } = await kitchen(w);
    const tue = (await w.run(w.alex, "SetDinner", { date: TUE, choice: "meal", mealId: pie })).dinnerId;
    await w.run(w.alex, "SetDinner", { date: THU, choice: "meal", mealId: pasta });
    await w.run(w.sam, "AddShoppingItem", { name: "Milk" });
    await w.run(w.sam, "AddShoppingItem", { name: "Washing-up liquid" });
    await w.run(w.sam, "AddShoppingItem", { name: "washing-up  liquid" });

    let milk = (await view(w)).shopping.find((l) => l.itemKey === "milk")!;
    expect(milk).toMatchObject({ forDates: [TUE, THU], byHand: true, got: false });
    expect((await view(w)).shopping.filter((l) => l.itemKey === "washing-up liquid")).toHaveLength(1);

    await w.run(w.alex, "RemoveDinner", { dinnerId: tue, version: 1 });
    const after = await view(w);
    milk = after.shopping.find((l) => l.itemKey === "milk")!;
    expect(milk).toMatchObject({ forDates: [THU], byHand: true });
    expect(after.shopping.map((l) => l.itemKey).sort()).toEqual(["cheese", "milk", "pasta", "washing-up liquid"]);

    // Ticking a line ticks it for every dinner; clearing it doesn't bring it back.
    await w.run(w.sam, "SetShoppingGot", { itemKey: "milk", got: true });
    expect((await view(w)).shopping.find((l) => l.itemKey === "milk")!.got).toBe(true);
    await w.run(w.sam, "ClearShoppingGot", {});
    expect((await view(w)).shopping.some((l) => l.itemKey === "milk")).toBe(false);
    await w.run(w.alex, "SetDinner", { date: THU, version: 1, choice: "meal", mealId: pasta });
    expect((await view(w)).shopping.some((l) => l.itemKey === "milk")).toBe(false);
  });

  it("asking a partner to cook stays a request until they say yes, and reserves nobody's evening", async () => {
    const w = await newWorld();
    const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId;
    void mia;
    const { pie } = await kitchen(w);
    const tue = (await w.run(w.alex, "SetDinner", { date: TUE, choice: "meal", mealId: pie })).dinnerId;
    const ask = await w.run(w.alex, "DinnerJob", { dinnerId: tue, role: "cook", owner: "partner" });

    const samJob = (await jobsFor(w.db, w.sam, NOW)).jobs.find((j) => j.id === ask.jobId)!;
    expect(samJob).toMatchObject({ ownerId: null, awaitingMyAnswer: true, forTitle: "dinner, Tue 6 Oct" });
    // The Sunday review shows it to Sam as theirs to answer, and to Alex as waiting.
    const range = reviewRange(NOW, "Europe/London");
    const review = async (who = w.alex) => decisionsFor(await getProjection(w.db, who, range.from, range.days, NOW), await jobsFor(w.db, who, NOW), range, NOW);
    expect((await review(w.sam)).find((i) => i.targetId === ask.jobId)).toMatchObject({ status: "You've been asked to take this on", actions: ["answer-job"] });
    expect((await review()).find((i) => i.targetId === ask.jobId)).toMatchObject({ status: "Asked Sam, not yet accepted" });
    // A dinner is not a plan: no moment, no busy time, no care arrangement, no "free evening" taken.
    expect(await count(w, sql`select count(*)::int as n from moments`)).toBe(0);
    expect(await count(w, sql`select count(*)::int as n from reservations`)).toBe(0);
    expect(await count(w, sql`select count(*)::int as n from care_arrangements`)).toBe(0);

    await w.run(w.sam, "AnswerJobOwner", { jobId: ask.jobId, version: samJob.version, accept: true });
    expect((await view(w)).dinners[0].jobs).toEqual([expect.objectContaining({ role: "cook", ownerId: w.sam.accountId, proposedOwnerId: null })]);
  });

  it("moving dinner moves its jobs and asks the cook again; a dinner eaten elsewhere retires them", async () => {
    const w = await newWorld();
    const { pie, toast } = await kitchen(w);
    const tue = (await w.run(w.alex, "SetDinner", { date: TUE, choice: "meal", mealId: pie })).dinnerId;
    const cook = await w.run(w.alex, "DinnerJob", { dinnerId: tue, role: "cook", owner: "partner" });
    await w.run(w.sam, "AnswerJobOwner", { jobId: cook.jobId, version: 1, accept: true });
    const clear = await w.run(w.alex, "DinnerJob", { dinnerId: tue, role: "clear", owner: "me" });
    // A reminder is waiting for Tuesday morning.
    await w.db.execute(sql`insert into outbox (household_id, event_type, dedupe_key, payload, available_at) values (${w.householdId}, 'notify', 'notify:job.due:x', ${JSON.stringify({ kind: "job.due", sourceId: clear.jobId, recipientId: w.alex.accountId })}::jsonb, now())`);

    // A job's own editor can't move it: the dinner owns the date.
    const clearJob = (await jobsFor(w.db, w.alex, NOW)).jobs.find((j) => j.id === clear.jobId)!;
    await expectCode(w.run(w.alex, "EditJob", { jobId: clear.jobId, version: clearJob.version, title: clearJob.title, cadence: "once", startsOn: THU }), "VALIDATION");

    await w.run(w.alex, "MoveDinner", { dinnerId: tue, version: 1, toDate: THU });
    const jobs = (await jobsFor(w.db, w.sam, NOW)).jobs.filter((j) => j.dinner?.id === tue);
    // Sam agreed to Tuesday, not Thursday: asked again. Alex's own job just moves.
    expect(jobs.map((j) => [j.dinner!.role, j.startsOn, j.ownerId, j.proposedOwnerId])).toEqual([
      ["cook", THU, null, w.sam.accountId],
      ["clear", THU, w.alex.accountId, null],
    ]);
    expect((await notices(w, "job.proposed")).at(-1)).toMatchObject({ recipient: w.sam.accountId });
    expect(await count(w, sql`select count(*)::int as n from outbox where dedupe_key = 'notify:job.due:x' and state = 'superseded'`)).toBe(1);
    expect((await view(w)).dinners[0].date).toBe(THU);

    // Thursday changes to eating at Gran's: nobody cooks or clears up, and Sam is told.
    await w.run(w.alex, "SetDinner", { date: THU, version: 2, choice: "elsewhere", note: "At Gran's" });
    expect((await jobsFor(w.db, w.alex, NOW)).jobs.filter((j) => j.dinner)).toEqual([]);
    expect((await notices(w, "job.retired")).map((n) => n.recipient)).toEqual([w.sam.accountId]);
    expect((await view(w)).dinners[0]).toMatchObject({ label: "Eating elsewhere: At Gran's", jobs: [] });
    expect((await view(w)).shopping).toEqual([]);

    // The quick fallback must be a meal marked quick.
    await expectCode(w.run(w.alex, "SetDinner", { date: MON, choice: "fallback", mealId: pie }), "VALIDATION");
    await w.run(w.alex, "SetDinner", { date: MON, choice: "fallback", mealId: toast });
    expect((await view(w)).dinners[0].label).toBe("Beans on toast (the quick one)");
  });

  it("dinners every week never fill the sixty-job limit; done one-offs stop counting; repeating jobs still do", async () => {
    const w = await newWorld();
    const { pie } = await kitchen(w);
    for (let i = 0; i < 58; i++) await w.run(w.alex, "AddJob", { title: `Weekly ${i}`, cadence: "weekly", startsOn: MON });
    // A one-off that's done stops taking a place.
    const form = (await w.run(w.alex, "AddJob", { title: "Consent form", cadence: "once", startsOn: MON })).jobId;
    await w.run(w.alex, "MarkJobDone", { jobId: form, dueOn: MON });
    // Last week's dinners: past evenings, still kept as history.
    const lastWeek = ["2026-09-28", "2026-09-29", "2026-09-30"];
    for (const d of lastWeek) {
      const id = (await w.run(w.alex, "SetDinner", { date: d, choice: "meal", mealId: pie })).dinnerId;
      await w.run(w.alex, "DinnerJob", { dinnerId: id, role: "cook", owner: "me" });
    }
    // 58 repeating + 1 done + 3 past dinners on record, but only 58 live: two more fit.
    await w.run(w.alex, "AddJob", { title: "Weekly 58", cadence: "weekly", startsOn: MON });
    const tue = (await w.run(w.alex, "SetDinner", { date: TUE, choice: "meal", mealId: pie })).dinnerId;
    await w.run(w.alex, "DinnerJob", { dinnerId: tue, role: "cook", owner: "me" });
    await expectCode(w.run(w.alex, "AddJob", { title: "One too many", cadence: "weekly", startsOn: MON }), "VALIDATION");
    expect(await count(w, sql`select count(*)::int as n from jobs where archived_at is null`)).toBe(64);
    // Past dinners don't show as overdue: they're history, not a backlog.
    expect((await jobsFor(w.db, w.alex, NOW)).jobs.filter((j) => j.dinner).map((j) => j.startsOn)).toEqual([TUE]);
  });
});

describe("checklists and templates on jobs", () => {
  it("keeps an optional checklist per due date, editable, with nobody told about ticks", async () => {
    const w = await newWorld();
    const football = (
      await w.run(w.alex, "AddJob", { title: "Football", cadence: "weekly", startsOn: MON, owner: "partner", steps: ["Check the time and place", "Wash and pack the kit", ""] })
    ).jobId;
    let job = (await jobsFor(w.db, w.sam, NOW)).jobs.find((j) => j.id === football)!;
    expect(job.steps.map((s) => s.text)).toEqual(["Check the time and place", "Wash and pack the kit"]);
    await w.run(w.sam, "AnswerJobOwner", { jobId: football, version: 1, accept: true });
    const before = await count(w, sql`select count(*)::int as n from outbox`);
    await w.run(w.sam, "TickJobStep", { stepId: job.steps[1].id, dueOn: MON, done: true });
    expect(await count(w, sql`select count(*)::int as n from outbox`)).toBe(before);
    job = (await jobsFor(w.db, w.sam, NOW)).jobs.find((j) => j.id === football)!;
    expect(job.steps.map((s) => s.done)).toEqual([false, true]);
    // Next week's football starts unticked.
    job = (await jobsFor(w.db, w.sam, new Date("2026-10-12T07:00:00Z"))).jobs.find((j) => j.id === football)!;
    expect(job.steps.map((s) => s.done)).toEqual([false, false]);

    // Removing a step that doesn't apply; the one kept keeps its tick.
    job = (await jobsFor(w.db, w.sam, NOW)).jobs.find((j) => j.id === football)!;
    await w.run(w.sam, "EditJob", { jobId: football, version: job.version, title: "Football", cadence: "weekly", startsOn: MON, steps: ["Wash and pack the kit"] });
    job = (await jobsFor(w.db, w.sam, NOW)).jobs.find((j) => j.id === football)!;
    expect(job.steps.map((s) => [s.text, s.done])).toEqual([["Wash and pack the kit", true]]);
  });

  it("leaves a household that never uses meals or checklists exactly as it was", async () => {
    const w = await newWorld();
    const bins = (await w.run(w.alex, "AddJob", { title: "Bins out", cadence: "weekly", startsOn: TUE })).jobId;
    const jobs = await jobsFor(w.db, w.alex, NOW);
    expect(jobs.jobs.find((j) => j.id === bins)).toMatchObject({ steps: [], dinner: null, forTitle: null });
    expect(await view(w)).toEqual({ today: MON, meals: [], dinners: [], shopping: [] });
  });
});
