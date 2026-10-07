import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { acceptances, careArrangements, memberships, moments, notifications, outbox, preparationTasks } from "@/db/schema";
import { isAgreed } from "@/domain/moments";
import { jobStillRelevant } from "./jobs";
import { leaveStillRelevant } from "./leave-by";

/**
 * Drains the transactional outbox (spec 10.1, 13.2). Processing is
 * at-least-once with idempotent effects: each delivery's dedupe key is
 * unique, so a replayed job cannot notify twice (INV-12). Every job
 * re-checks membership and source state before delivering, so a cancelled
 * or changed plan never produces a stale reminder (AT-21).
 */

export interface NotifyPayload {
  recipientId: string;
  kind: string;
  text: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  householdId: string;
  /** For a leave-by reminder: which occurrence of a repeating event. */
  occurrenceStart?: number;
  /** When this stops being worth pushing (epoch ms); default is the push window. */
  expiresAt?: number;
}

export async function stillRelevant(db: Db, p: NotifyPayload, now: Date): Promise<boolean> {
  const [member] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.householdId, p.householdId), eq(memberships.accountId, p.recipientId), isNull(memberships.endsAt)));
  if (!member) return false;

  if (p.sourceType === "moment") {
    const [m] = await db.select().from(moments).where(eq(moments.id, p.sourceId));
    if (!m || m.sharing !== "shared" || !m.participantIds.includes(p.recipientId)) return false;
    if (p.kind === "moment.cancelled") return m.lifecycle === "cancelled";
    if (m.lifecycle !== "planned") return false;
    if (m.materialVersion !== p.sourceVersion) return false;
    // A reminder is only true while everyone still agrees to this version.
    if (p.kind === "moment.reminder") {
      const adults = await db
        .select({ id: memberships.accountId })
        .from(memberships)
        .where(and(eq(memberships.householdId, p.householdId), isNull(memberships.endsAt)));
      const acc = await db.select().from(acceptances).where(eq(acceptances.momentId, m.id)).orderBy(acceptances.createdAt);
      return isAgreed(
        m.participantIds,
        adults.map((a) => a.id),
        m.materialVersion,
        acc.map((a) => ({ actorId: a.actorId, materialVersion: a.materialVersion, decision: a.decision })),
      );
    }
    return true;
  }
  if (p.sourceType === "care") {
    const [c] = await db.select().from(careArrangements).where(eq(careArrangements.id, p.sourceId));
    return !!c && c.state === "proposed" && c.version === p.sourceVersion;
  }
  if (p.sourceType === "job") return jobStillRelevant(db, p);
  if (p.sourceType === "event" && p.kind === "event.leave") return leaveStillRelevant(db, p, now);
  if (p.sourceType === "task") {
    const [t] = await db.select().from(preparationTasks).where(eq(preparationTasks.id, p.sourceId));
    return !!t && t.state === "open" && t.ownerId === p.recipientId;
  }
  return true;
}

export async function processOutbox(db: Db, now = new Date(), limit = 50): Promise<{ delivered: number; skipped: number; failed: number }> {
  const stats = { delivered: 0, skipped: 0, failed: 0 };
  await db.transaction(async (tx) => {
    const jobs = await tx
      .select()
      .from(outbox)
      .where(and(eq(outbox.state, "pending"), lte(outbox.availableAt, now)))
      .orderBy(outbox.availableAt)
      .limit(limit)
      .for("update", { skipLocked: true });

    for (const job of jobs) {
      try {
        if (job.eventType === "notify") {
          const p = job.payload as NotifyPayload;
          if (await stillRelevant(tx as unknown as Db, p, now)) {
            await tx
              .insert(notifications)
              .values({
                accountId: p.recipientId,
                householdId: p.householdId,
                kind: p.kind,
                text: p.text,
                sourceType: p.sourceType,
                sourceId: p.sourceId,
                dedupeKey: job.dedupeKey,
                relevance: p,
                pushExpiresAt: typeof p.expiresAt === "number" ? new Date(p.expiresAt) : null,
              })
              .onConflictDoNothing({ target: notifications.dedupeKey });
            stats.delivered++;
          } else {
            stats.skipped++;
          }
        }
        await tx.update(outbox).set({ state: "done", processedAt: now, attempts: sql`${outbox.attempts} + 1` }).where(eq(outbox.id, job.id));
      } catch (err) {
        stats.failed++;
        await tx
          .update(outbox)
          .set({
            attempts: sql`${outbox.attempts} + 1`,
            lastError: String((err as Error).message).slice(0, 300),
            state: job.attempts + 1 >= 5 ? "failed" : "pending",
            availableAt: new Date(now.getTime() + 60_000 * 2 ** job.attempts),
          })
          .where(eq(outbox.id, job.id));
      }
    }
  });
  return stats;
}
