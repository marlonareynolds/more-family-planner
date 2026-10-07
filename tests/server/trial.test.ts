import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PRODUCT_EVENT_TYPES } from "@/server/analytics";
import { trialFor } from "@/server/queries/trial";
import { exportAccount } from "@/server/queries/exports";
import { expectCode, newWorld, timed } from "./harness";

const rows = async (w: Awaited<ReturnType<typeof newWorld>>) =>
  ((await w.db.execute(sql`select event_type, account_id, household_id, reason from product_events order by occurred_at`)) as unknown as {
    rows: { event_type: string; account_id: string; household_id: string | null; reason: string | null }[];
  }).rows;

describe("trial instrumentation (spec 21)", () => {
  it("records the journey as content-free events", async () => {
    const w = await newWorld();
    const people = [w.alex.accountId, w.sam.accountId];
    const m = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Anniversary at Luca's", notes: "Ask about Mia's allergy", span: timed("2030-10-11", "19:00", "21:00"), participantIds: people });
    await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
    await w.run(w.sam, "RespondToMoment", { momentId: m.momentId, materialVersion: 1, decision: "accepted" });
    await w.run(w.alex, "CreateMoment", { kind: "me", title: "Swim", span: timed("2030-10-12", "08:00", "09:00"), participantIds: [w.alex.accountId] });

    const events = await rows(w);
    expect(events.map((e) => e.event_type)).toEqual(["household_created", "partner_joined", "first_plan_created", "moment_shared", "moment_agreed"]);
    expect(events.every((e) => e.household_id === w.householdId)).toBe(true);
    expect(events.every((e) => (PRODUCT_EVENT_TYPES as readonly string[]).includes(e.event_type))).toBe(true);
    const dump = JSON.stringify(events);
    for (const secret of ["Anniversary", "Luca", "Mia", "allergy", "Swim"]) expect(dump).not.toContain(secret);
  });

  it("counts a clashing save, and records nothing for an adult who opts out", async () => {
    const w = await newWorld();
    const m = await w.run(w.alex, "CreateMoment", { kind: "family", title: "Park", span: timed("2030-10-12", "10:00", "12:00"), participantIds: [w.alex.accountId] });
    await expectCode(w.run(w.alex, "CompleteMoment", { momentId: m.momentId, version: 99 }), "STALE_VERSION");
    expect((await rows(w)).find((e) => e.event_type === "save_conflict")?.reason).toBe("CompleteMoment:STALE_VERSION");

    await w.run(w.sam, "SetAnalyticsOptOut", { optOut: true });
    const before = (await rows(w)).length;
    const s = await w.run(w.sam, "CreateMoment", { kind: "me", title: "Run", span: timed("2030-10-13", "07:00", "08:00"), participantIds: [w.sam.accountId] });
    await w.run(w.sam, "ShareMoment", { momentId: s.momentId, version: s.version }).catch(() => {});
    await w.run(w.sam, "SaveTrialResponse", { weekKey: "2030-10-07", meMoments: 1 });
    expect((await rows(w)).filter((e) => e.account_id === w.sam.accountId).length).toBe(1); // partner_joined, before opting out
    expect((await rows(w)).length).toBe(before);
  });

  it("keeps each adult's trial answers private unless they share them", async () => {
    const w = await newWorld();
    await w.run(w.alex, "SaveTrialResponse", { weekKey: "2030-10-07", baseline: true, usMoments: 1, minutesOutside: 90, friction: "Too many texts", shareWithTrial: false });
    await w.run(w.sam, "SaveTrialResponse", { weekKey: "2030-10-07", meMoments: 2, helped: "Seeing the week", shareWithTrial: true });
    await expectCode(w.run(w.sam, "SaveTrialResponse", { weekKey: "2030-10-08" }), "VALIDATION");

    const samView = await trialFor(w.db, w.sam, w.householdId);
    expect(JSON.stringify(samView)).not.toContain("Too many texts");
    expect(samView.shared).toHaveLength(0);
    expect(samView.coverage.find((c) => c.accountId === w.alex.accountId)?.weeks).toEqual(["2030-10-07"]);

    const alexView = await trialFor(w.db, w.alex, w.householdId);
    expect(alexView.shared.map((r) => r.helped)).toEqual(["Seeing the week"]);
    expect(alexView.mine[0].friction).toBe("Too many texts");

    // Withdrawing consent hides it again; saving the same week updates in place.
    await w.run(w.sam, "SaveTrialResponse", { weekKey: "2030-10-07", meMoments: 2, helped: "Seeing the week", shareWithTrial: false });
    expect((await trialFor(w.db, w.alex, w.householdId)).shared).toHaveLength(0);
    expect((await exportAccount(w.db, w.sam)).trialResponses).toHaveLength(1);
  });
});
