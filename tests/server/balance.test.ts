import { describe, expect, it } from "vitest";
import { balanceFor } from "@/server/queries/balance";
import { newWorld, timed } from "./harness";

const NOW = new Date("2030-10-20T12:00:00Z");

describe("how time has been shared (spec 8.3)", () => {
  it("totals agreed Me time per adult, ignores private drafts, and asks a question instead of scoring", async () => {
    const w = await newWorld();
    for (const day of ["2030-10-08", "2030-10-10"]) {
      const m = await w.run(w.alex, "CreateMoment", { kind: "me", title: "Climbing", span: timed(day, "18:00", "20:00"), participantIds: [w.alex.accountId] });
      await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
    }
    await w.run(w.sam, "CreateMoment", { kind: "me", title: "Secret plan", span: timed("2030-10-09", "18:00", "23:00"), participantIds: [w.sam.accountId] });

    const asAlex = await balanceFor(w.db, w.alex, w.householdId, NOW);
    const alex = asAlex.adults.find((a) => a.id === w.alex.accountId)!;
    const sam = asAlex.adults.find((a) => a.id === w.sam.accountId)!;
    expect(alex.meDone).toBe(4);
    expect(sam.meDone).toBe(0);
    expect(asAlex.question).toEqual({ forId: w.sam.accountId, text: "Sam has had less time for themselves lately. Could you cover so they get some?" });
    expect(JSON.stringify(asAlex)).not.toMatch(/Climbing|Secret/);

    const asSam = await balanceFor(w.db, w.sam, w.householdId, NOW);
    expect(asSam.adults.find((a) => a.id === w.sam.accountId)!.meDone).toBe(0); // a draft isn't time had
    expect(asSam.question?.text).toBe("You've had less time for yourself lately. Want to find some?");
  });
});
