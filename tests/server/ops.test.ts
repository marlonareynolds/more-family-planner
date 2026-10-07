import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { notifications, opsRuns, outbox, supportRequests } from "@/db/schema";
import { healthChecks, healthy } from "@/server/ops/health";
import { setEmailTransport, type Email } from "@/server/reach/email";
import { submitSupport } from "@/server/support";
import { runTick } from "@/server/tick";
import { newWorld } from "./harness";

const check = (checks: Awaited<ReturnType<typeof healthChecks>>, name: string) => checks.find((c) => c.name === name)!;

afterEach(() => {
  setEmailTransport(null);
  delete process.env.MORE_SUPPORT_EMAIL;
});

describe("operational alerts", () => {
  it("reports an unhealthy scheduler until a run succeeds, then goes stale after 30 minutes", async () => {
    const w = await newWorld();
    const now = new Date("2030-10-07T12:00:00Z");
    expect(check(await healthChecks(w.db, now), "Scheduler")).toMatchObject({ ok: false, detail: "Has never run" });

    const { errors } = await runTick(w.db, now);
    expect(errors).toEqual([]);
    const fresh = await healthChecks(w.db, new Date(Date.now() + 60_000));
    expect(check(fresh, "Scheduler").ok).toBe(true);
    expect(check(await healthChecks(w.db, new Date(Date.now() + 31 * 60_000)), "Scheduler")).toMatchObject({ ok: false });
  });

  it("a failing step is recorded and the run reports failure, while the other steps still run", async () => {
    const w = await newWorld();
    // Take away a table phone delivery needs, as a broken deploy might.
    await w.db.execute(sql`alter table notifications rename to notifications_gone`);
    const { errors, stats } = await runTick(w.db);
    expect(errors.some((e) => e.startsWith("push:"))).toBe(true);
    expect(stats.rituals).not.toHaveProperty("error");
    const [run] = await w.db.select().from(opsRuns).where(eq(opsRuns.name, "tick"));
    expect(run.lastErrorAt).toBeInstanceOf(Date);
    expect(run.lastOkAt).toBeNull();
    await w.db.execute(sql`alter table notifications_gone rename to notifications`);
    expect(check(await healthChecks(w.db), "Scheduler")).toMatchObject({ ok: false, detail: expect.stringContaining("push:") });
  });

  it("flags overdue work and a burst of lost reminders", async () => {
    const w = await newWorld();
    const now = new Date();
    await runTick(w.db, now);
    await w.db.insert(outbox).values({ eventType: "unknown.kind", dedupeKey: "stuck", payload: {}, availableAt: new Date(now.getTime() - 3_600_000), state: "pending" });
    for (let i = 0; i < 6; i++) await w.db.insert(notifications).values({ accountId: w.sam.accountId, householdId: w.householdId, kind: "test", text: "x", dedupeKey: `f${i}`, pushState: "failed" });
    const checks = await healthChecks(w.db, now);
    expect(check(checks, "Outbox")).toMatchObject({ ok: false, detail: expect.stringContaining("1 events waiting") });
    expect(check(checks, "Phone reminders")).toMatchObject({ ok: false, detail: "Last day: 0 sent, 6 failed, 0 expired" });
    expect(healthy(checks)).toBe(false);
  });
});

describe("help page", () => {
  it("keeps every message, emails it when configured, and survives account closure", async () => {
    const w = await newWorld();
    const sent: Email[] = [];
    expect((await submitSupport(w.db, null, { topic: "problem", message: "Can't sign in", contact: "" })).emailed).toBe(false);

    process.env.MORE_SUPPORT_EMAIL = "help@example.com";
    setEmailTransport(async (e) => (sent.push(e), true));
    const r = await submitSupport(w.db, w.sam.accountId, { topic: "privacy", message: "Delete my <data>", contact: "sam@example.com" });
    expect(r.emailed).toBe(true);
    expect(sent[0]).toMatchObject({ to: "help@example.com", subject: "More support: Privacy or my data" });
    expect(sent[0].html).toContain("Delete my &lt;data&gt;");
    expect(check(await healthChecks(w.db), "Support").detail).toMatch(/^2 messages waiting/);

    await w.run(w.sam, "LeaveHousehold", { confirm: true });
    await w.run(w.sam, "CloseAccount", { confirm: "close" }, { householdId: undefined });
    const rows = await w.db.select().from(supportRequests);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.accountId === null)).toBe(true);
  });
});
