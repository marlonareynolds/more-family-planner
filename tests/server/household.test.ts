import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { executeCommand } from "@/server/commands";
import { accountFor } from "@/server/auth";
import { expectCode, newWorld, timed } from "./harness";
import { getWeek } from "@/server/queries/week";

describe("household lifecycle", () => {
  it("AT-01: a revoked invitation cannot be used", async () => {
    const w = await newWorld({ partner: false });
    const { token, invitationId } = await w.run(w.alex, "CreateInvite", {});
    await w.run(w.alex, "RevokeInvite", { invitationId });
    await expectCode(executeCommand(w.sam, { command: "JoinHousehold", idempotencyKey: randomUUID(), payload: { token } }), "INVITE_INVALID");
    const week = await w.week(w.alex, "2026-10-05");
    expect(week.adults).toHaveLength(1);
  });

  it("a third adult cannot join and a new link revokes the old one", async () => {
    const w = await newWorld({ partner: false });
    const first = await w.run(w.alex, "CreateInvite", {});
    const second = await w.run(w.alex, "CreateInvite", {});
    await expectCode(executeCommand(w.sam, { command: "JoinHousehold", idempotencyKey: randomUUID(), payload: { token: first.token } }), "INVITE_INVALID");
    await executeCommand(w.sam, { command: "JoinHousehold", idempotencyKey: randomUUID(), payload: { token: second.token } });
    await expectCode(w.run(w.alex, "CreateInvite", {}), "CONFLICT");
  });

  it("AT-02: a command prepared before someone left is refused at commit", async () => {
    const w = await newWorld();
    const before = await w.week(w.alex, "2026-10-05");
    await w.run(w.sam, "LeaveHousehold", { confirm: true });
    await expectCode(
      w.run(w.alex, "AddEvent", { title: "Swim", span: timed("2026-10-06", "17:00", "18:00"), adultIds: [w.alex.accountId] }, { expected: { membershipRevision: before.household.membershipRevision } }),
      "MEMBERSHIP_CHANGED",
    );
    // A former member can no longer write at all.
    await expectCode(w.run(w.sam, "AddEvent", { title: "x", span: timed("2026-10-06", "17:00", "18:00") }), "NOT_FOUND");
  });

  it("AT-03 and AT-14: a new partner inherits no consent; the leaver's journal survives", async () => {
    const w = await newWorld();
    await executeCommand(w.sam, { command: "SaveJournalEntry", idempotencyKey: randomUUID(), payload: { entryDate: "2026-10-01", body: "Private thought", tags: ["work"] } });
    const { momentId, version } = await w.run(w.alex, "CreateMoment", {
      kind: "us", title: "Dinner", span: timed("2030-10-10", "19:00", "22:00"), participantIds: [w.alex.accountId, w.sam.accountId],
    });
    await w.run(w.alex, "ShareMoment", { momentId, version });
    await w.run(w.sam, "RespondToMoment", { momentId, materialVersion: 1, decision: "accepted" });
    let week = await w.week(w.alex, "2030-10-07");
    expect(week.moments[0].agreed).toBe(true);

    await w.run(w.sam, "LeaveHousehold", { confirm: true });
    const jo = await accountFor(w.db, { subject: "test:jo", displayName: "Jo" });
    const { token } = await w.run(w.alex, "CreateInvite", {});
    await executeCommand(jo, { command: "JoinHousehold", idempotencyKey: randomUUID(), payload: { token } });

    week = await w.week(w.alex, "2030-10-07");
    expect(week.moments[0].agreed).toBe(false);
    expect(week.moments[0].review).toBe("needs_review");
    expect(week.moments[0].participantIds).toEqual([w.alex.accountId]);
    const joWeek = await getWeek(w.db, jo, "2030-10-07");
    expect(JSON.stringify(joWeek)).not.toContain("Private thought");

    const { listJournal } = await import("@/server/queries/journal");
    const entries = await listJournal(w.db, w.sam, {});
    expect(entries.entries[0].body).toBe("Private thought");
  });

  it("AT-04: adding a child reopens plans that need care", async () => {
    const w = await newWorld();
    await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    const { momentId, version } = await w.run(w.alex, "CreateMoment", {
      kind: "me", title: "Run", span: timed("2030-10-10", "09:00", "10:00"), participantIds: [w.alex.accountId], needsCare: true,
    });
    await w.run(w.alex, "ShareMoment", { momentId, version });
    await w.run(w.alex, "ArrangeCare", { kind: "parent", responsibleAccountId: w.sam.accountId, childIds: [(await w.week(w.alex, "2030-10-07")).children[0].id], span: timed("2030-10-10", "09:00", "10:00") });
    let week = await w.week(w.sam, "2030-10-07");
    const ask = week.careAwaitingMe[0];
    await w.run(w.sam, "RespondToCare", { arrangementId: ask.id, version: ask.version, decision: "confirm" });
    week = await w.week(w.alex, "2030-10-07");
    expect(week.moments[0].careState).toBe("covered");

    await w.run(w.alex, "AddChild", { preferredName: "Leo", ageBand: "0-4" });
    week = await w.week(w.alex, "2030-10-07");
    expect(week.moments[0].careState).toBe("partly_covered");
    expect(week.moments[0].review).toBe("needs_review");
    expect(week.moments[0].lifecycle).toBe("planned");
  });
});
