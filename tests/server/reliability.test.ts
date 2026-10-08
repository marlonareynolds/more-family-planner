import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notifications, outbox } from "@/db/schema";
import { safeNextPath } from "@/lib/safe-next";
import { processOutbox } from "@/server/outbox";
import { GET as authCallback } from "@/app/auth/callback/route";
import { newWorld } from "./harness";

/** Quality release, priority 5: reliability defects reproduced in the reviews. */

describe("sign-in redirect stays inside More", () => {
  it.each([
    ["/\\evil.com", "/today"],
    ["//evil.com", "/today"],
    ["/%5Cevil.com", "/today"],
    ["/%2F%2Fevil.com", "/today"],
    ["https://evil.com", "/today"],
    ["/\tevil.com", "/today"],
    ["javascript:alert(1)", "/today"],
    ["", "/today"],
    ["/join/abc123", "/join/abc123"],
    ["/week?date=2026-10-12", "/week?date=2026-10-12"],
  ])("next=%j goes to %s", (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });

  it("the callback route never redirects off-site, even for /\\evil.com", async () => {
    const res = await authCallback(new Request("https://more.example/auth/callback?next=" + encodeURIComponent("/\\evil.com")));
    expect(new URL(res.headers.get("location")!).origin).toBe("https://more.example");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/today");
  });
});

describe("notification batch", () => {
  it("one job's database error doesn't roll back the rest of the batch", async () => {
    const w = await newWorld();
    const good = { recipientId: w.sam.accountId, kind: "test.note", text: "Hello", sourceType: "other", sourceId: randomUUID(), sourceVersion: 1, householdId: w.householdId };
    const t0 = new Date("2026-10-07T09:00:00Z");
    // A malformed household id makes Postgres raise inside the job, which used to spoil the whole transaction.
    await w.db.insert(outbox).values({ householdId: w.householdId, eventType: "notify", dedupeKey: "bad", payload: { ...good, householdId: "not-a-uuid" }, availableAt: new Date(t0.getTime() - 2000) });
    await w.db.insert(outbox).values({ householdId: w.householdId, eventType: "notify", dedupeKey: "good", payload: good, availableAt: new Date(t0.getTime() - 1000) });

    const stats = await processOutbox(w.db, t0);
    expect(stats).toEqual({ delivered: 1, skipped: 0, failed: 1 });
    const [bad] = await w.db.select().from(outbox).where(eq(outbox.dedupeKey, "bad"));
    expect(bad.state).toBe("pending");
    expect(bad.attempts).toBe(1);
    expect(bad.lastError).toBeTruthy();
    const delivered = await w.db.select().from(notifications).where(eq(notifications.dedupeKey, "good"));
    expect(delivered).toHaveLength(1);
  });
});
