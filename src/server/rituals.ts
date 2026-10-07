import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { acceptances, households, moments, outbox, rituals } from "@/db/schema";
import { findConflicts } from "@/domain/availability";
import { ritualDates } from "@/domain/rituals";
import { addDays, instantToLocalDate, localToInstantCompatible } from "@/domain/time";
import { currentAdults, reserve } from "./commands/helpers";
import { loadBusy } from "./queries/busy";

/**
 * Turn agreed rituals into ordinary moments for the next four weeks. Each
 * date is its own plan: its care is checked like any other, it can be
 * skipped alone, and the unique (ritual, date) index means a skipped date
 * is never recreated.
 */

export const RITUAL_HORIZON_DAYS = 28;

type RitualRow = typeof rituals.$inferSelect;
type HouseholdRow = typeof households.$inferSelect;

export function ritualActive(r: Pick<RitualRow, "endedAt" | "participantIds" | "agreedBy">): boolean {
  return !r.endedAt && r.participantIds.every((p) => r.agreedBy.includes(p));
}

export async function generateRitual(tx: Tx, household: HouseholdRow, r: RitualRow, now: Date): Promise<number> {
  if (!ritualActive(r)) return 0;
  const adults = (await currentAdults(tx, household.id)).map((a) => a.id);
  if (r.participantIds.some((p) => !adults.includes(p))) return 0;
  const tz = household.timeZone;
  const today = instantToLocalDate(now.getTime(), tz);
  let created = 0;
  for (const date of ritualDates({ cadence: r.cadence, startsOn: r.startsOn }, today, addDays(today, RITUAL_HORIZON_DAYS - 1))) {
    const start = localToInstantCompatible(`${date}T${r.startTime}`, tz);
    const end = start + r.durationMinutes * 60_000;
    if (start <= now.getTime()) continue;
    const [m] = await tx
      .insert(moments)
      .values({
        householdId: household.id,
        kind: r.kind,
        organiserId: r.organiserId,
        title: r.title,
        notes: r.notes,
        activityKey: r.activityKey,
        ritualId: r.id,
        ritualDate: date,
        startAt: new Date(start),
        endAt: new Date(end),
        participantIds: r.participantIds,
        childIds: r.childIds,
        needsCare: r.needsCare,
        budgetMinor: r.budgetMinor,
        lifecycle: "planned",
        sharing: "shared",
      })
      .onConflictDoNothing()
      .returning();
    if (!m) continue;
    created++;
    // Agreeing to the ritual is agreeing to each of its dates as first set.
    await tx.insert(acceptances).values(
      r.participantIds.map((actorId) => ({ momentId: m.id, actorId, materialVersion: 1, membershipRevision: household.membershipRevision, decision: "accepted" as const })),
    );
    const busy = await loadBusy(tx, household.id, { start: start - 86_400_000, end: end + 86_400_000 });
    const clashes = findConflicts({ personIds: m.participantIds, start, end, excludeSourceIds: [m.id] }, busy, r.organiserId);
    let reserved = false;
    if (!clashes.length) {
      try {
        await tx.transaction(async (sp) => reserve(sp, household.id, "moment", m.id, m.participantIds, start, end));
        reserved = true;
      } catch {
        reserved = false;
      }
    }
    if (!reserved) {
      await tx.update(moments).set({ review: "needs_review", reviewReason: "This date clashes with something in the diary" }).where(eq(moments.id, m.id));
      continue;
    }
    const remindAt = start - 24 * 3_600_000;
    if (remindAt > now.getTime()) {
      for (const p of m.participantIds) {
        await tx
          .insert(outbox)
          .values({
            householdId: household.id,
            eventType: "notify",
            dedupeKey: `notify:moment.reminder:${m.id}:1:${p}`,
            payload: {
              recipientId: p,
              kind: "moment.reminder",
              text: r.kind === "me" ? "Your protected time is tomorrow." : "You have a plan together tomorrow.",
              sourceType: "moment",
              sourceId: m.id,
              sourceVersion: 1,
              householdId: household.id,
            },
            availableAt: new Date(remindAt),
          })
          .onConflictDoNothing({ target: outbox.dedupeKey });
      }
    }
  }
  if (created) {
    await tx.update(households).set({ scheduleRevision: sql`${households.scheduleRevision} + 1` }).where(eq(households.id, household.id));
  }
  return created;
}

/** Keep every active ritual four weeks ahead. Cheap when nothing is due. */
export async function topUpRituals(db: Db, now = new Date(), householdId?: string): Promise<{ created: number }> {
  const active = await db
    .select({ id: rituals.id, householdId: rituals.householdId })
    .from(rituals)
    .where(and(isNull(rituals.endedAt), householdId ? eq(rituals.householdId, householdId) : undefined));
  let created = 0;
  for (const { id, householdId: hid } of active) {
    created += await db.transaction(async (tx) => {
      // Same lock order as a command: household first.
      const [h] = await tx.select().from(households).where(and(eq(households.id, hid), isNull(households.deletedAt))).for("update");
      if (!h) return 0;
      const [r] = await tx.select().from(rituals).where(eq(rituals.id, id));
      return r ? generateRitual(tx, h, r, now) : 0;
    });
  }
  return { created };
}
