import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rateLimits, usageReservations } from "@/db/schema";
import { accountFor } from "@/server/auth";
import { executeCommand } from "@/server/commands";
import { DESK_READ_BUDGET_MS, readWithAi, spendByHousehold, worstCasePence, type AiItem, type CountFn, type DeskInput, type ReadFn } from "@/server/desk-ai";
import { errorResponse, readJson } from "@/server/http";
import { pruneRateLimits, sharedRateLimit } from "@/server/rate-limit";
import { expectCode, newWorld } from "./harness";

const usage = { input_tokens: 3_000, output_tokens: 1_500 };
const read: ReadFn = async () => ({ items: [] as AiItem[], usage });
const counted: CountFn = async () => 3_000;
const letter = (householdId: string): DeskInput => ({ householdId, today: "2026-10-27", timeZone: "Europe/London", text: "Harvest Assembly on Friday 30 October at 9:15am.", file: null });

describe("AI reading allowance per household, under one ceiling", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.DESK_AI;
    process.env.DESK_AI_MONTHLY_CAP_PENCE = "100000";
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DESK_AI_MONTHLY_CAP_PENCE;
    delete process.env.DESK_AI_HOUSEHOLD_MONTHLY_PENCE;
  });

  it("one household using its allowance doesn't stop another household's reads", async () => {
    // Room for exactly one read in flight per household.
    process.env.DESK_AI_HOUSEHOLD_MONTHLY_PENCE = String(worstCasePence(3_000) + 5);
    const w = await newWorld();
    const kim = await accountFor(w.db, { subject: "test:kim", displayName: "Kim" });
    const other = (await executeCommand(kim, { command: "CreateHousehold", idempotencyKey: randomUUID(), payload: { name: "The Patels" } })).result as { householdId: string };

    let release!: () => void;
    const slow: ReadFn = () => new Promise((resolve) => (release = () => resolve({ items: [], usage })));
    const first = readWithAi(w.db, w.alex, letter(w.householdId), slow, undefined, counted);
    await new Promise((r) => setTimeout(r, 50));
    const refused = await expectCode(readWithAi(w.db, w.sam, letter(w.householdId), read, undefined, counted), "ALLOWANCE_EXHAUSTED");
    expect(refused.message).toMatch(/Your household/);
    // The other household still has its own allowance.
    await readWithAi(w.db, kim, letter(other.householdId), read, undefined, counted);
    release();
    await first;
  });

  it("still stops everyone at the ceiling", async () => {
    process.env.DESK_AI_HOUSEHOLD_MONTHLY_PENCE = "100000";
    process.env.DESK_AI_MONTHLY_CAP_PENCE = "50";
    const w = await newWorld();
    const refused = await expectCode(readWithAi(w.db, w.alex, letter(w.householdId), read, undefined, counted), "ALLOWANCE_EXHAUSTED");
    expect(refused.message).not.toMatch(/Your household/);
  });

  it("reports this month's spend per household for the operator", async () => {
    const w = await newWorld();
    await readWithAi(w.db, w.alex, letter(w.householdId), read, undefined, counted);
    await readWithAi(w.db, w.sam, letter(w.householdId), read, undefined, counted);
    // Last month's reads don't count.
    await w.db.insert(usageReservations).values({ householdId: w.householdId, requestId: "desk-old", maxCostMinor: 80, actualCostMinor: 50, state: "settled", createdAt: new Date("2026-09-15T12:00:00Z") });
    const spend = await spendByHousehold(w.db);
    expect(spend.households).toEqual([{ householdId: w.householdId, reads: 2, settledPence: 8, runningPence: 0, allowancePence: 200 }]);
    expect(spend.totalPence).toBe(8);
    expect(spend.ceilingPence).toBe(100000);
  });
});

describe("rate limits shared by every server instance", () => {
  it("counts across instances, resets with the window, and stores no address", async () => {
    const w = await newWorld();
    const now = 1_000_000_000_000;
    for (let i = 0; i < 3; i++) expect(await sharedRateLimit(w.db, "ask:203.0.113.9", 3, 60_000, now)).toBe(true);
    expect(await sharedRateLimit(w.db, "ask:203.0.113.9", 3, 60_000, now + 1)).toBe(false);
    expect(await sharedRateLimit(w.db, "ask:198.51.100.1", 3, 60_000, now + 1)).toBe(true);
    // A slower clock on another instance still counts towards the newer window.
    expect(await sharedRateLimit(w.db, "ask:198.51.100.1", 1, 60_000, now + 60_000)).toBe(true);
    expect(await sharedRateLimit(w.db, "ask:198.51.100.1", 1, 60_000, now)).toBe(false);
    expect(await sharedRateLimit(w.db, "ask:203.0.113.9", 3, 60_000, now + 60_000)).toBe(true);
    const rows = await w.db.select().from(rateLimits);
    expect(JSON.stringify(rows)).not.toMatch(/203\.0|198\.51/);
    expect(await pruneRateLimits(w.db, new Date(now + 10 * 60_000))).toBe(rows.length);
    expect(await w.db.select().from(rateLimits)).toEqual([]);
  });
});

describe("bad request bodies answer 400, not 500", () => {
  const post = (body: string) => new Request("https://more.example/api/v1/commands", { method: "POST", body, headers: { "content-type": "application/json" } });
  const status = async (body: string) => {
    try {
      await readJson(post(body));
      return 200;
    } catch (err) {
      return errorResponse(err).status;
    }
  };

  it("refuses a body that isn't JSON", async () => {
    expect(await status("command=Hello")).toBe(400);
    expect(await status("")).toBe(400);
  });

  it("refuses a null character anywhere, before it reaches the database", async () => {
    expect(await status(JSON.stringify({ payload: { title: "Swim\u0000ming" } }))).toBe(400);
    expect(await status(JSON.stringify({ payload: { list: [{ note: "a\u0000" }] } }))).toBe(400);
    expect(await status(JSON.stringify({ ["key\u0000"]: 1 }))).toBe(400);
    expect(await status(JSON.stringify({ payload: { title: "Swimming" } }))).toBe(200);
  });
});

describe("the Desk read fits the hosting limit", () => {
  it("declares a duration Vercel allows on every plan with Fluid compute, with room to settle the cost", () => {
    const route = readFileSync("src/app/api/v1/desk/read/route.ts", "utf8");
    const maxDuration = Number(/export const maxDuration = (\d+)/.exec(route)?.[1]);
    expect(maxDuration).toBeLessThanOrEqual(300); // Hobby's maximum with Fluid compute
    expect(DESK_READ_BUDGET_MS + 20_000).toBeLessThanOrEqual(maxDuration * 1000);
  });
});

describe("error reports carry no household content", () => {
  it("drops request data, people and query values", async () => {
    const { scrubEvent } = await import("@/server/ops/error-report");
    const event = scrubEvent({
      type: undefined,
      request: { url: "https://more.example/api/v1/commands?token=abc", method: "POST", data: '{"title":"Mia\'s birthday"}', cookies: { s: "x" }, headers: { cookie: "s=x" } },
      user: { ip_address: "203.0.113.9", email: "a@example.com" },
      breadcrumbs: [{ message: "Mia's birthday" }],
      exception: { values: [{ type: "DrizzleQueryError", value: 'Failed query: insert into "events" ("title") values ($1)\nparams: Mia\'s birthday' }] },
    });
    const text = JSON.stringify(event);
    expect(text).not.toMatch(/Mia|203\.0|example\.com|token=|cookie/i);
    expect(event.exception?.values?.[0].value).toMatch(/^Failed query: insert into "events"/);
    expect(event.request).toEqual({ url: "https://more.example/api/v1/commands", method: "POST" });
  });
});
