import type { Db } from "@/db/client";
import { syncDue } from "./calendar-sync";
import { processOutbox } from "./outbox";
import { sendWeeklyDigests } from "./reach/digest";
import { deliverPushes } from "./reach/push";
import { queueJobReminders } from "./jobs";
import { topUpRituals } from "./rituals";

/**
 * Everything time-driven, in one place: called by the scheduled tick (every
 * 15 minutes from GitHub Actions, daily from Vercel Cron as a backstop).
 * Each step is idempotent, so overlapping runs are harmless.
 */
export async function runTick(db: Db, now = new Date()) {
  const rituals = await topUpRituals(db, now).catch((e) => ({ error: String(e) }));
  const jobs = await queueJobReminders(db, now).catch((e) => ({ error: String(e) }));
  const outbox = await processOutbox(db, now);
  const push = await deliverPushes(db, now);
  const email = await sendWeeklyDigests(db, now);
  const calendars = await syncDue(db, 6 * 3_600_000, { limit: 40 });
  return { rituals, jobs, outbox, push, email, calendars };
}

/** After someone changes something: deliver what that made due, quickly. */
export async function afterChange(db: Db, now = new Date()) {
  await processOutbox(db, now, 25);
  await deliverPushes(db, now, 50);
}
