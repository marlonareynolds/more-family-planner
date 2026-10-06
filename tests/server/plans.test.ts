import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { executeCommand } from "@/server/commands";
import { processOutbox } from "@/server/outbox";
import { expectCode, newWorld, timed } from "./harness";

const WEEK = "2030-10-07";

describe("dates, privacy and money", () => {
  it("AT-08: two overlapping invitations cannot both be accepted", async () => {
    const w = await newWorld();
    const people = [w.alex.accountId, w.sam.accountId];
    const a = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Cinema", span: timed("2030-10-11", "19:00", "22:00"), participantIds: people });
    const b = await w.run(w.sam, "CreateMoment", { kind: "us", title: "Concert", span: timed("2030-10-11", "20:00", "23:00"), participantIds: people });
    await w.run(w.alex, "ShareMoment", { momentId: a.momentId, version: a.version });
    await w.run(w.sam, "ShareMoment", { momentId: b.momentId, version: b.version });
    const results = await Promise.allSettled([
      w.run(w.sam, "RespondToMoment", { momentId: a.momentId, materialVersion: 1, decision: "accepted" }),
      w.run(w.alex, "RespondToMoment", { momentId: b.momentId, materialVersion: 1, decision: "accepted" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const week = await w.week(w.alex, WEEK);
    expect(week.moments.filter((m) => m.agreed)).toHaveLength(1);
  });

  it("a material edit releases the reservation and requires renewed agreement; wording edits do not", async () => {
    const w = await newWorld();
    const people = [w.alex.accountId, w.sam.accountId];
    const m = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Dinner", span: timed("2030-10-11", "19:00", "21:00"), participantIds: people, budgetMinor: 6000 });
    await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
    await w.run(w.sam, "RespondToMoment", { momentId: m.momentId, materialVersion: 1, decision: "accepted" });
    let mv = (await w.week(w.alex, WEEK)).moments[0];
    expect(mv.stage).toBe("Arrangements ready");

    const fields = { title: "Supper", span: timed("2030-10-11", "19:00", "21:00"), participantIds: people, budgetMinor: 6000 };
    await w.run(w.alex, "EditMoment", { momentId: m.momentId, version: mv.version, fields });
    mv = (await w.week(w.alex, WEEK)).moments[0];
    expect(mv.agreed).toBe(true);
    expect(mv.materialVersion).toBe(1);

    await w.run(w.alex, "EditMoment", { momentId: m.momentId, version: mv.version, fields: { ...fields, span: timed("2030-10-12", "19:00", "21:00") } });
    mv = (await w.week(w.alex, WEEK)).moments[0];
    expect(mv.agreed).toBe(false);
    expect(mv.stage).toBe("Invited");
    // Answering the old version is refused.
    await expectCode(w.run(w.sam, "RespondToMoment", { momentId: m.momentId, materialVersion: 1, decision: "accepted" }), "STALE_VERSION");
    await w.run(w.sam, "RespondToMoment", { momentId: m.momentId, materialVersion: 2, decision: "accepted" });
    expect((await w.week(w.alex, WEEK)).moments[0].agreed).toBe(true);
  });

  it("AT-13 and INV-11: private items leak no detail to a partner", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddEvent", { title: "Therapy session", notes: "Room 4", visibility: "busy_only", span: timed("2030-10-08", "10:00", "11:00"), adultIds: [w.alex.accountId] });
    await w.run(w.alex, "AddEvent", { title: "Secret gift shopping", visibility: "private", span: timed("2030-10-09", "10:00", "11:00"), adultIds: [w.alex.accountId] });
    await w.run(w.alex, "CreateMoment", { kind: "us", title: "Anniversary draft", span: timed("2030-10-10", "19:00", "21:00"), participantIds: [w.alex.accountId, w.sam.accountId] });
    const m = await w.run(w.sam, "CreateMoment", { kind: "us", title: "Walk", span: timed("2030-10-08", "10:30", "11:30"), participantIds: [w.alex.accountId, w.sam.accountId] });
    await w.run(w.sam, "ShareMoment", { momentId: m.momentId, version: m.version });
    const err = await expectCode(w.run(w.alex, "RespondToMoment", { momentId: m.momentId, materialVersion: 1, decision: "accepted" }), "CONFLICT");
    // The conflict is reported to Alex, who owns the event, with its title.
    expect(JSON.stringify(err.details)).toContain("Therapy session");

    const samWeek = JSON.stringify(await w.week(w.sam, WEEK));
    expect(samWeek).not.toContain("Therapy");
    expect(samWeek).not.toContain("Room 4");
    expect(samWeek).not.toContain("Secret gift");
    expect(samWeek).not.toContain("Anniversary draft");
    const busy = (await w.week(w.sam, WEEK)).events;
    expect(busy).toHaveLength(1);
    expect(busy[0].title).toBe("Busy");
  });

  it("AT-21: a reminder queued before cancellation is never delivered", async () => {
    const w = await newWorld();
    const m = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Dinner", span: timed("2030-10-11", "19:00", "21:00"), participantIds: [w.alex.accountId, w.sam.accountId] });
    await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
    await w.run(w.sam, "RespondToMoment", { momentId: m.momentId, materialVersion: 1, decision: "accepted" });
    // The worker delivers what is due now; tomorrow's reminder stays queued.
    await processOutbox(w.db);
    const mv = (await w.week(w.alex, WEEK)).moments[0];
    await w.run(w.alex, "CancelMoment", { momentId: m.momentId, version: mv.version });
    const late = new Date(Date.UTC(2030, 9, 11, 0, 0));
    await processOutbox(w.db, late);
    const notes = (await w.week(w.sam, WEEK, late)).notifications.map((n) => n.text);
    expect(notes).toContain("Alex invited you to a plan.");
    expect(notes).toContain("A plan was cancelled.");
    expect(notes.some((t) => t.includes("tomorrow"))).toBe(false);
    // Running the worker again delivers nothing twice (INV-12).
    await processOutbox(w.db, late);
    expect((await w.week(w.sam, WEEK, late)).notifications).toHaveLength(notes.length);
  });

  it("8.9 and AT-22/23: £80 for four children, £30 refund, replayed payment", async () => {
    const w = await newWorld();
    for (const n of ["A", "B", "C", "D"]) await w.run(w.alex, "AddChild", { preferredName: n, ageBand: "5-7" });
    const kids = (await w.week(w.alex, WEEK)).children.map((k) => k.id);
    await w.run(w.alex, "CreateHoliday", { name: "Inset day", startDate: "2030-10-08", endDate: "2030-10-08", dailyStart: "09:00", dailyEnd: "15:00", childIds: kids });
    const care = await w.run(w.alex, "ArrangeCare", { kind: "external", providerName: "Holiday club", confirmed: true, childIds: kids, span: timed("2030-10-08", "09:00", "15:00") });
    const { expenseId } = await w.run(w.alex, "AddExpense", { label: "Holiday club", committedMinor: 8000, sourceType: "care", sourceId: care.arrangementId });
    const key = randomUUID();
    const pay = { command: "RecordTransaction", householdId: w.householdId, idempotencyKey: key, payload: { expenseId, kind: "payment", amountMinor: 8000 } };
    await executeCommand(w.alex, pay);
    const replay = await executeCommand(w.alex, pay);
    expect(replay.replayed).toBe(true);
    await expectCode(executeCommand(w.alex, { ...pay, payload: { expenseId, kind: "payment", amountMinor: 9000 } }), "IDEMPOTENCY_CONFLICT");
    await w.run(w.alex, "RecordTransaction", { expenseId, kind: "refund", amountMinor: 3000 });
    await expectCode(w.run(w.alex, "RecordTransaction", { expenseId, kind: "refund", amountMinor: 6000 }), "VALIDATION");

    const week = await w.week(w.alex, WEEK);
    expect(week.expenses).toHaveLength(1);
    expect(week.money.netPaidMinor).toBe(5000);
    expect(week.care[0].groups).toHaveLength(1);
    expect(week.care[0].groups[0].childIds).toHaveLength(4);
    expect(week.care[0].groups[0].state).toBe("covered");
  });

  it("AT-07: only the named parent can confirm their care or tick their task", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    const kid = (await w.week(w.alex, WEEK)).children[0].id;
    const ask = await w.run(w.alex, "ArrangeCare", { kind: "parent", responsibleAccountId: w.sam.accountId, childIds: [kid], span: timed("2030-10-08", "09:00", "12:00") });
    await expectCode(w.run(w.alex, "RespondToCare", { arrangementId: ask.arrangementId, version: 1, decision: "confirm" }), "FORBIDDEN");
    const m = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Lunch", span: timed("2030-10-09", "12:00", "13:00"), participantIds: [w.alex.accountId, w.sam.accountId] });
    await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
    const t = await w.run(w.alex, "AddTask", { momentId: m.momentId, title: "Book table", ownerId: w.sam.accountId });
    await expectCode(w.run(w.alex, "SetTaskDone", { taskId: t.taskId, version: 1, done: true }), "FORBIDDEN");
    await w.run(w.sam, "SetTaskDone", { taskId: t.taskId, version: 1, done: true });
  });

  it("AT-12: parent care stops counting when that parent books something else", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    const kid = (await w.week(w.alex, WEEK)).children[0].id;
    await w.run(w.sam, "ArrangeCare", { kind: "parent", responsibleAccountId: w.sam.accountId, childIds: [kid], span: timed("2030-10-08", "09:00", "12:00") });
    expect((await w.week(w.alex, WEEK)).care.length).toBe(0);
    await w.run(w.alex, "AddEvent", { title: "School trip", span: timed("2030-10-08", "08:00", "17:00"), childIds: [kid] });
    await w.run(w.sam, "CreateHoliday", { name: "Inset day", startDate: "2030-10-08", endDate: "2030-10-08", dailyStart: "09:00", dailyEnd: "12:00", childIds: [kid] });
    let day = (await w.week(w.alex, WEEK)).care[0];
    expect(day.groups[0].state).toBe("covered");
    await w.run(w.sam, "AddEvent", { title: "Dentist", span: timed("2030-10-08", "10:00", "11:00"), adultIds: [w.sam.accountId] });
    day = (await w.week(w.alex, WEEK)).care[0];
    expect(day.groups[0].state).toBe("partly_covered");
    expect(day.groups[0].gaps).toHaveLength(1);
  });
});
