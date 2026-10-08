import { and, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { households, jobDone, jobs, outbox } from "@/db/schema";
import { fmtDate } from "@/components/format";
import { jobDates } from "@/domain/jobs";
import { addDays, instantToLocalDate, localToInstantCompatible } from "@/domain/time";

/**
 * Queue each owned job's next reminder: the evening before (18:00) for jobs
 * like the bins, otherwise the morning of (07:30). The dedupe key is per due
 * date and owner, so running this every tick never doubles up, and the
 * outbox re-checks ownership and "done" before anything is delivered.
 */
export async function queueJobReminders(db: Db, now = new Date()): Promise<{ queued: number }> {
  const rows = await db
    .select({ job: jobs, timeZone: households.timeZone })
    .from(jobs)
    .innerJoin(households, eq(households.id, jobs.householdId))
    .where(and(isNull(jobs.archivedAt), isNotNull(jobs.ownerId), isNull(households.deletedAt)));
  if (!rows.length) return { queued: 0 };
  const done = await db
    .select({ jobId: jobDone.jobId, dueOn: jobDone.dueOn })
    .from(jobDone)
    .where(and(inArray(jobDone.jobId, rows.map((r) => r.job.id)), gte(jobDone.dueOn, addDays(instantToLocalDate(now.getTime(), "UTC"), -2))));
  const doneKeys = new Set(done.map((d) => `${d.jobId}:${d.dueOn}`));
  let queued = 0;
  for (const { job, timeZone } of rows) {
    const today = instantToLocalDate(now.getTime(), timeZone);
    for (const dueOn of jobDates(job, today, addDays(today, 1))) {
      if (doneKeys.has(`${job.id}:${dueOn}`)) continue;
      const at = job.remindDayBefore ? localToInstantCompatible(`${addDays(dueOn, -1)}T18:00`, timeZone) : localToInstantCompatible(`${dueOn}T07:30`, timeZone);
      // Too late to be useful: don't remind about the bins at midnight.
      if (at < now.getTime() - 6 * 3_600_000) continue;
      const sourceVersion = Number(dueOn.replaceAll("-", ""));
      const inserted = await db
        .insert(outbox)
        .values({
          householdId: job.householdId,
          eventType: "notify",
          dedupeKey: `notify:job.due:${job.id}:${sourceVersion}:${job.ownerId}`,
          payload: {
            recipientId: job.ownerId,
            kind: "job.due",
            text: job.remindDayBefore ? `For tomorrow${job.dueTime ? `, by ${job.dueTime}` : ""}: ${job.title}.` : `Today${job.dueTime ? `, by ${job.dueTime}` : ""}: ${job.title}.`,
            sourceType: "job",
            sourceId: job.id,
            sourceVersion,
            householdId: job.householdId,
          },
          availableAt: new Date(at),
        })
        .onConflictDoNothing({ target: outbox.dedupeKey })
        .returning({ id: outbox.id });
      queued += inserted.length;
    }
  }
  return { queued };
}

/** Is a job notification still true at delivery time? */
export async function jobStillRelevant(db: Db, p: { kind: string; sourceId: string; sourceVersion: number; recipientId: string }): Promise<boolean> {
  const [j] = await db.select().from(jobs).where(eq(jobs.id, p.sourceId));
  if (!j) return false;
  // "It's off your list" is about the job being retired, so it still holds.
  if (p.kind === "job.retired" && j.archivedAt) return j.version === p.sourceVersion;
  if (j.archivedAt) return false;
  if (p.kind === "job.proposed") return j.proposedOwnerId === p.recipientId && j.version === p.sourceVersion;
  if (p.kind === "job.due") {
    if (j.ownerId !== p.recipientId) return false;
    const s = String(p.sourceVersion);
    const dueOn = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    const [d] = await db.select({ jobId: jobDone.jobId }).from(jobDone).where(and(eq(jobDone.jobId, j.id), eq(jobDone.dueOn, dueOn)));
    return !d;
  }
  return true;
}

/** "Bins out: Tue, Fri" lines for one adult's jobs in a week, for the Sunday email. */
export async function jobLinesFor(db: Db, householdId: string, accountId: string, days: string[]): Promise<string[]> {
  if (!days.length) return [];
  const rows = await db.select().from(jobs).where(and(eq(jobs.householdId, householdId), eq(jobs.ownerId, accountId), isNull(jobs.archivedAt)));
  return rows
    .map((j) => ({ title: j.title, dates: jobDates(j, days[0], days.at(-1)!) }))
    .filter((j) => j.dates.length)
    .map((j) => `${j.title}: ${j.dates.map((d) => fmtDate(d)).join(", ")}`);
}
