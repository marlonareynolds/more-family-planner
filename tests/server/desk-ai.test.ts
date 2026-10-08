import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usageReservations } from "@/db/schema";
import { accountFor } from "@/server/auth";
import { cleanItems, costPence, readWithAi, worstCasePence, type AiItem, type CountFn, type DeskInput, type ReadFn } from "@/server/desk-ai";
import { expectCode, newWorld } from "./harness";

const fair: AiItem = {
  kind: "event",
  role: "event",
  title: "Christmas Fair",
  startDate: "2026-12-05",
  endDate: "2026-12-05",
  startTime: "11:00",
  endTime: "14:00",
  arriveBy: null,
  location: null,
  details: null,
  repeat: null,
  repeatUntil: null,
  forWhom: null,
  dateCertain: true,
  pickupChange: false,
  forItem: null,
  quote: "Our Christmas Fair will take place on Saturday 5 December from 11:00am to 2:00pm.",
};
const usage = { input_tokens: 3_000, output_tokens: 1_500 };
const input = (householdId: string, extra: Partial<DeskInput> = {}): DeskInput => ({ householdId, today: "2026-10-07", timeZone: "Europe/London", text: "Our Christmas Fair will take place on Saturday 5 December from 11:00am to 2:00pm.", file: null, ...extra });
const answer = (items: AiItem[]): ReadFn => async () => ({ items, usage });
/** The free counting call, stubbed: a short letter. */
const counted = (n = 3_000): CountFn => async () => n;

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
    await expectCode(readWithAi(w.db, w.alex, input(w.householdId), answer([fair]), undefined, counted()), "FEATURE_DISABLED");
    expect(await w.db.select().from(usageReservations)).toEqual([]);
  });

  it("reads for a household member and records what the read cost", async () => {
    const w = await newWorld();
    expect(await readWithAi(w.db, w.alex, input(w.householdId), answer([fair]), undefined, counted())).toEqual([fair]);
    const [row] = await w.db.select().from(usageReservations);
    expect(row).toMatchObject({ state: "settled", actualCostMinor: 4 }); // (3,000 × $4 + 1,500 × $20) / 1M = $0.042, about 3.4p, rounded up
  });

  it("refuses someone outside the household before anything is sent", async () => {
    const w = await newWorld();
    const stranger = await accountFor(w.db, { subject: "test:stranger", displayName: "Kim" });
    let called = false;
    await expectCode(readWithAi(w.db, stranger, input(w.householdId), async () => ((called = true), { items: [], usage }), undefined, counted()), "NOT_FOUND");
    expect(called).toBe(false);
  });

  it("stops at the monthly cap, counting reads still in flight at their worst case", async () => {
    process.env.DESK_AI_MONTHLY_CAP_PENCE = String(worstCasePence(3_000) + 5);
    const w = await newWorld();
    let release!: () => void;
    const slow: ReadFn = () => new Promise((resolve) => (release = () => resolve({ items: [fair], usage })));
    const first = readWithAi(w.db, w.alex, input(w.householdId), slow, undefined, counted());
    await new Promise((r) => setTimeout(r, 50));
    // The first read hasn't finished, so its worst case still counts against the cap.
    await expectCode(readWithAi(w.db, w.sam, input(w.householdId), answer([fair]), undefined, counted()), "ALLOWANCE_EXHAUSTED");
    release();
    await first;
  });

  it("an uncertain failure records exactly the reservation, never more (Marlon's large-upload example)", async () => {
    process.env.DESK_AI_MONTHLY_CAP_PENCE = "100000";
    const w = await newWorld();
    // A big photo: the old estimate reserved for 400,000 tokens (£1.54) but recorded 2 million (£6.67) on failure.
    const big = input(w.householdId, { text: "", file: { mediaType: "image/jpeg", data: "A".repeat(4_000_000) } });
    const broken: ReadFn = async () => {
      throw new Error("socket hang up");
    };
    await expectCode(readWithAi(w.db, w.alex, big, broken, undefined, counted(2_400)), "FEATURE_DISABLED");
    const [row] = await w.db.select().from(usageReservations);
    expect(row.state).toBe("settled");
    expect(row.actualCostMinor).toBe(row.maxCostMinor);
  });

  it("counts a refused attempt and its fallback, each at its own model's price", async () => {
    const w = await newWorld();
    const withFallback: ReadFn = async () => ({
      items: [fair],
      usage: {
        input_tokens: 3_000,
        output_tokens: 1_500,
        model: "claude-opus-5",
        iterations: [
          { type: "message", model: "claude-opus-5-5", input_tokens: 3_000, output_tokens: 200 },
          { type: "fallback_message", model: "claude-opus-5", input_tokens: 3_000, output_tokens: 1_500 },
        ],
      },
    });
    await readWithAi(w.db, w.alex, input(w.householdId), withFallback, undefined, counted());
    const [row] = await w.db.select().from(usageReservations);
    // (3,000×$4 + 200×$20) + (3,000×$5 + 1,500×$25) = $0.0685, about 5.5p, rounded up.
    expect(row.actualCostMinor).toBe(6);
  });

  it("the reservation covers the dearest possible read: both attempts, full output, dearest model", () => {
    for (const tokens of [500, 3_000, 40_000, 400_000]) {
      const dearest = { input_tokens: tokens + 2_000, output_tokens: 16_000 };
      const worst = costPence({
        ...dearest,
        iterations: [
          { type: "message", model: "claude-opus-5-5", ...dearest },
          { type: "fallback_message", model: "claude-opus-5", ...dearest },
        ],
      });
      expect(worst).toBeLessThanOrEqual(worstCasePence(tokens));
    }
  });

  it("can't reach the counting service: nothing is reserved or sent", async () => {
    const w = await newWorld();
    let called = false;
    const noCount: CountFn = async () => {
      throw new Error("offline");
    };
    await expectCode(readWithAi(w.db, w.alex, input(w.householdId), async () => ((called = true), { items: [], usage }), undefined, noCount), "FEATURE_DISABLED");
    expect(called).toBe(false);
    expect(await w.db.select().from(usageReservations)).toEqual([]);
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
