import { and, count, eq, gte, inArray, isNull, lt, min } from "drizzle-orm";
import type { Db } from "@/db/client";
import { notifications, opsRuns, outbox, supportRequests } from "@/db/schema";

/**
 * Operational signals for the one person running More: did the scheduler
 * run, did it fail, is work piling up, is anyone waiting for help. Counts
 * and times only, never anyone's content.
 */

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** The scheduler should run every 5 minutes; this much silence is a fault. */
export const TICK_STALE_MS = 30 * 60_000;
const BACKLOG_MS = 30 * 60_000;

/** Run a job and record how it went in ops_runs. Errors are recorded, then rethrown. */
export async function recordRun<T>(db: Db, name: string, now: Date, fn: () => Promise<{ stats: T; errors: string[] }>): Promise<{ stats: T; errors: string[] }> {
  await db.insert(opsRuns).values({ name, lastStartedAt: now }).onConflictDoUpdate({ target: opsRuns.name, set: { lastStartedAt: now } });
  let result: { stats: T; errors: string[] };
  try {
    result = await fn();
  } catch (e) {
    result = { stats: null as T, errors: [`run: ${(e as Error).message ?? String(e)}`] };
  }
  const done = new Date();
  await db
    .update(opsRuns)
    .set(result.errors.length ? { lastErrorAt: done, lastError: result.errors.join("; ").slice(0, 1000), lastStats: result.stats } : { lastOkAt: done, lastStats: result.stats })
    .where(eq(opsRuns.name, name));
  return result;
}

const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`);

export async function healthChecks(db: Db, now = new Date()): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  const nowMs = now.getTime();

  const [tick] = await db.select().from(opsRuns).where(eq(opsRuns.name, "tick"));
  if (!tick?.lastOkAt) {
    checks.push({ name: "Scheduler", ok: false, detail: tick?.lastError ? `Never succeeded. Last error: ${tick.lastError}` : "Has never run" });
  } else {
    const since = nowMs - tick.lastOkAt.getTime();
    const failing = tick.lastErrorAt && tick.lastErrorAt > tick.lastOkAt;
    checks.push({
      name: "Scheduler",
      ok: since <= TICK_STALE_MS && !failing,
      detail: failing ? `Last run failed ${ago(nowMs - tick.lastErrorAt!.getTime())} ago: ${tick.lastError}` : `Last good run ${ago(since)} ago`,
    });
  }

  const [queued] = await db
    .select({ n: count(), oldest: min(outbox.availableAt) })
    .from(outbox)
    .where(and(eq(outbox.state, "pending"), lt(outbox.availableAt, new Date(nowMs - BACKLOG_MS))));
  checks.push({ name: "Outbox", ok: !queued?.n, detail: queued?.n ? `${queued.n} events waiting, oldest due ${ago(nowMs - new Date(queued.oldest!).getTime())} ago` : "Nothing overdue" });

  const [failedOutbox] = await db.select({ n: count() }).from(outbox).where(and(eq(outbox.state, "failed"), gte(outbox.createdAt, new Date(nowMs - 86_400_000))));
  checks.push({ name: "Outbox failures", ok: !failedOutbox?.n, detail: failedOutbox?.n ? `${failedOutbox.n} events failed in the last day` : "None in the last day" });

  const pushes = await db
    .select({ state: notifications.pushState, n: count() })
    .from(notifications)
    .where(and(inArray(notifications.pushState, ["sent", "failed", "expired"]), gte(notifications.createdAt, new Date(nowMs - 86_400_000))))
    .groupBy(notifications.pushState);
  const by = Object.fromEntries(pushes.map((p) => [p.state, Number(p.n)]));
  const sent = by.sent ?? 0;
  const lost = (by.failed ?? 0) + (by.expired ?? 0);
  // A few phones going offline is normal; most notices failing is not.
  checks.push({ name: "Phone reminders", ok: lost < 5 || lost <= sent, detail: `Last day: ${sent} sent, ${by.failed ?? 0} failed, ${by.expired ?? 0} expired` });

  const [support] = await db.select({ n: count(), oldest: min(supportRequests.createdAt) }).from(supportRequests).where(isNull(supportRequests.handledAt));
  checks.push({
    name: "Support",
    ok: true,
    detail: support?.n ? `${support.n} messages waiting, oldest ${ago(nowMs - new Date(support.oldest!).getTime())} ago` : "No messages waiting",
  });
  return checks;
}

export const healthy = (checks: HealthCheck[]) => checks.every((c) => c.ok);

