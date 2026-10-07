import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, children, events, households, memberships, outbox } from "@/db/schema";
import { isDuty } from "@/domain/next-up";
import { inQuietHours, localClock } from "@/domain/reach";
import { loadEventOccurrences } from "./queries/busy";

/** How long before setting off the reminder is due. */
export const LEAVE_NOTICE_MS = 20 * 60_000;
/** Queue a little ahead so a late tick still lands it in time. */
const LOOKAHEAD_MS = 3 * 3_600_000;

/**
 * "Leave by 17:10 for Sam's football." For children's events with travel
 * time, to each adult down for them, about twenty minutes before they need
 * to set off. Noise is the app's job, so this is one of the few reminders
 * that comes on its own. Never during someone's quiet hours, and re-checked
 * at delivery, so a moved or cancelled pickup never sends a stale one.
 */
export async function queueLeaveReminders(db: Db, now = new Date()): Promise<{ queued: number }> {
  const nowMs = now.getTime();
  const horizon = { start: nowMs, end: nowMs + LOOKAHEAD_MS + 10 * 3_600_000 };
  const houses = await db
    .selectDistinct({ id: households.id })
    .from(events)
    .innerJoin(households, eq(households.id, events.householdId))
    .where(and(isNull(households.deletedAt), isNull(events.cancelledAt), gt(events.travelBeforeMinutes, 0)));
  let queued = 0;
  for (const h of houses) {
    const due = (await loadEventOccurrences(db, h.id, horizon)).filter((o) => {
      const leave = o.start - o.row.travelBeforeMinutes * 60_000;
      return o.row.travelBeforeMinutes > 0 && leave - LEAVE_NOTICE_MS < nowMs + LOOKAHEAD_MS && leave > nowMs;
    });
    if (!due.length) continue;
    const adults = await db
      .select({ id: accounts.id, timeZone: accounts.timeZone, quietStart: accounts.quietStart, quietEnd: accounts.quietEnd })
      .from(memberships)
      .innerJoin(accounts, eq(accounts.id, memberships.accountId))
      .where(and(eq(memberships.householdId, h.id), isNull(memberships.endsAt)));
    const kids = await db.select({ id: children.id, name: children.preferredName }).from(children).where(eq(children.householdId, h.id));
    for (const o of due) {
      const leave = o.start - o.row.travelBeforeMinutes * 60_000;
      for (const a of adults) {
        if (!isDuty({ allDay: o.row.allDay, detailsHidden: false, childIds: o.row.childIds, adultIds: o.row.adultIds }, a.id)) continue;
        const remindAt = Math.max(nowMs, leave - LEAVE_NOTICE_MS);
        if (inQuietHours(localClock(remindAt, a.timeZone), a.quietStart, a.quietEnd)) continue;
        // Someone else's private or busy-only event keeps its title to itself.
        const named = o.row.visibility === "shared" || o.row.ownerId === a.id;
        const who = o.row.childIds.map((id) => kids.find((k) => k.id === id)?.name).filter(Boolean).join(" and ") || "the children";
        const text = `Leave by ${localClock(leave, a.timeZone)} for ${named ? o.row.title : who}.`;
        const r = await db
          .insert(outbox)
          .values({
            householdId: h.id,
            eventType: "notify",
            dedupeKey: `notify:event.leave:${o.eventId}:${o.row.version}:${o.start}:${a.id}`,
            payload: { recipientId: a.id, kind: "event.leave", text, sourceType: "event", sourceId: o.eventId, sourceVersion: o.row.version, householdId: h.id, occurrenceStart: o.start },
            availableAt: new Date(remindAt),
          })
          .onConflictDoNothing({ target: outbox.dedupeKey })
          .returning({ id: outbox.id });
        queued += r.length;
      }
    }
  }
  return { queued };
}

/** At delivery: the occurrence still happens at that time, with the same travel, and they're still down for it. */
export async function leaveStillRelevant(db: Db, p: { householdId: string; sourceId: string; sourceVersion: number; recipientId: string; occurrenceStart?: number }, now: Date): Promise<boolean> {
  if (typeof p.occurrenceStart !== "number") return false;
  const [row] = await db.select({ version: events.version }).from(events).where(and(eq(events.id, p.sourceId), eq(events.householdId, p.householdId)));
  if (!row || row.version !== p.sourceVersion) return false;
  const occ = await loadEventOccurrences(db, p.householdId, { start: p.occurrenceStart - 1, end: p.occurrenceStart + 1 });
  return occ.some((o) => o.eventId === p.sourceId && o.start === p.occurrenceStart && o.row.adultIds.includes(p.recipientId) && o.start - o.row.travelBeforeMinutes * 60_000 > now.getTime() - 15 * 60_000);
}
