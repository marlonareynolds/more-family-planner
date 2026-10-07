import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usageReservations } from "@/db/schema";
import { accountFor } from "@/server/auth";
import { cleanItems, readWithAi, worstCasePence, type AiItem, type DeskInput, type ReadFn } from "@/server/desk-ai";
import { expectCode, newWorld } from "./harness";

const fair: AiItem = { kind: "event", role: "event", title: "Christmas Fair", startDate: "2026-12-05", endDate: "2026-12-05", startTime: "11:00", endTime: "14:00", quote: "Our Christmas Fair will take place on Saturday 5 December from 11:00am to 2:00pm." };
const usage = { input_tokens: 3_000, output_tokens: 1_500 };
const input = (householdId: string, extra: Partial<DeskInput> = {}): DeskInput => ({ householdId, today: "2026-10-07", timeZone: "Europe/London", text: "Our Christmas Fair will take place on Saturday 5 December from 11:00am to 2:00pm.", file: null, ...extra });
const answer = (items: AiItem[]): ReadFn => async () => ({ items, usage });

describe("Household desk AI reader", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.DESK_AI;
    delete process.env.DESK_AI_MONTHLY_CAP_PENCE;
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("is off without a key, and spends nothing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const w = await newWorld();
    await expectCode(readWithAi(w.db, w.alex, input(w.householdId), answer([fair])), "FEATURE_DISABLED");
    expect(await w.db.select().from(usageReservations)).toEqual([]);
  });

  it("reads for a household member and records what the read cost", async () => {
    const w = await newWorld();
    expect(await readWithAi(w.db, w.alex, input(w.householdId), answer([fair]))).toEqual([fair]);
    const [row] = await w.db.select().from(usageReservations);
    expect(row).toMatchObject({ state: "settled", actualCostMinor: 4 }); // (3,000 × $4 + 1,500 × $20) / 1M = $0.042, about 3.4p, rounded up
  });

  it("refuses someone outside the household before anything is sent", async () => {
    const w = await newWorld();
    const stranger = await accountFor(w.db, { subject: "test:stranger", displayName: "Kim" });
    let called = false;
    await expectCode(readWithAi(w.db, stranger, input(w.householdId), async () => ((called = true), { items: [], usage })), "NOT_FOUND");
    expect(called).toBe(false);
  });

  it("stops at the monthly cap, counting reads still in flight at their worst case", async () => {
    process.env.DESK_AI_MONTHLY_CAP_PENCE = String(worstCasePence(10_000) + 5);
    const w = await newWorld();
    let release!: () => void;
    const slow: ReadFn = () => new Promise((resolve) => (release = () => resolve({ items: [fair], usage })));
    const first = readWithAi(w.db, w.alex, input(w.householdId), slow);
    await new Promise((r) => setTimeout(r, 50));
    // The first read hasn't finished, so its worst case still counts against the cap.
    await expectCode(readWithAi(w.db, w.sam, input(w.householdId), answer([fair])), "ALLOWANCE_EXHAUSTED");
    release();
    await first;
  });

  it("drops malformed items and impossible times rather than passing them on", () => {
    expect(
      cleanItems([
        fair,
        { ...fair, startDate: "2026-11-31" },
        { ...fair, endDate: "2026-12-04" },
        { ...fair, title: "  " },
        { ...fair, kind: "holiday", startTime: "09:00", endTime: "17:00" },
        { ...fair, startTime: "25:00" },
        { ...fair, endTime: "10:00" },
      ]).map((i) => [i.kind, i.startTime, i.endTime]),
    ).toEqual([
      ["event", "11:00", "14:00"],
      ["holiday", null, null],
      ["event", null, null],
      ["event", "11:00", null],
    ]);
  });
});
