import type { Db } from "@/db/client";
import { syncDue } from "./calendar-sync";
import { processOutbox } from "./outbox";
import { sendWeeklyDigests } from "./reach/digest";
import { deliverPushes } from "./reach/push";
import { queueJobReminders } from "./jobs";
import { topUpRituals } from "./rituals";
import { notifyMeClashes } from "./me-time";
import { queueLeaveReminders } from "./leave-by";
import { queueWeatherSwaps, refreshForecasts } from "./weather";
import { recordRun } from "./ops/health";

/**
 * Everything time-driven, in one place: called by the scheduler every few
 * minutes and daily from Vercel Cron as a backstop. Each step is idempotent,
 * so overlapping runs are harmless. A failing step doesn't stop the others;
 * it is recorded in ops_runs and makes the run report failure.
 */
export async function runTick(db: Db, now = new Date()) {
  return recordRun(db, "tick", now, async () => {
    const errors: string[] = [];
    const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> => {
      try {
        return await fn();
      } catch (e) {
        const error = (e as Error)?.message ?? String(e);
        errors.push(`${name}: ${error}`);
        return { error };
      }
    };
    const stats = {
      rituals: await step("rituals", () => topUpRituals(db, now)),
      jobs: await step("jobs", () => queueJobReminders(db, now)),
      weather: await step("weather", () => refreshForecasts(db, now)),
      swaps: await step("swaps", () => queueWeatherSwaps(db, now)),
      meTime: await step("meTime", () => notifyMeClashes(db, now)),
      leave: await step("leave", () => queueLeaveReminders(db, now)),
      outbox: await step("outbox", () => processOutbox(db, now)),
      push: await step("push", () => deliverPushes(db, now)),
      email: await step("email", () => sendWeeklyDigests(db, now)),
      // Signed-in calendars go round every tick so new plans show as busy promptly.
      connected: await step("connected", () => syncDue(db, 14 * 60_000, { limit: 40, connected: true })),
      calendars: await step("calendars", () => syncDue(db, 6 * 3_600_000, { limit: 40 })),
    };
    return { stats, errors };
  });
}

/** After someone changes something: deliver what that made due, quickly. */
export async function afterChange(db: Db, now = new Date()) {
  await processOutbox(db, now, 25);
  await deliverPushes(db, now, 50);
}
