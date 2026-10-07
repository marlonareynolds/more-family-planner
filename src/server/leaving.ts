import { randomUUID } from "node:crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { calendarFeeds, households, memberships } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import type { Actor } from "./auth";
import { clearPushedBusy, type ClearResult } from "./calendar-sync";
import type { HttpFetch } from "./calendar-providers";
import { executeCommand } from "./commands";

/**
 * Leaving or deleting a household, with the "Busy" blocks More wrote into
 * Google or Outlook taken out first (review R09, BR-14). Leaving takes out
 * the leaver's blocks; deleting takes out everyone's. A provider that can't
 * be reached never traps anyone: they leave anyway and are told exactly
 * which blocks may still be there. A block written while this runs is taken
 * back out by the sync itself, because the feed is gone by then.
 */
export async function leaveHousehold(
  db: Db,
  actor: Actor,
  householdId: string,
  how: { command: "LeaveHousehold"; payload: { confirm: true } } | { command: "DeleteHousehold"; payload: { confirmName: string } },
  http?: HttpFetch,
  now = new Date(),
): Promise<{ cleanup: ClearResult }> {
  // Check first, so nobody's calendar is touched for a request that will be refused.
  const [member] = await db
    .select({ name: households.name })
    .from(memberships)
    .innerJoin(households, eq(households.id, memberships.householdId))
    .where(and(eq(memberships.householdId, householdId), eq(memberships.accountId, actor.accountId), isNull(memberships.endsAt), isNull(households.deletedAt)));
  if (!member) throw new DomainError("NOT_FOUND", "You are not in this household.");
  if (how.command === "DeleteHousehold" && how.payload.confirmName.trim() !== member.name) throw new DomainError("VALIDATION", "Type the household name exactly to confirm.");
  const feeds = await db
    .select({ id: calendarFeeds.id })
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.householdId, householdId), ne(calendarFeeds.provider, "ics"), how.command === "LeaveHousehold" ? eq(calendarFeeds.accountId, actor.accountId) : undefined));
  const cleanup: ClearResult = { removed: 0, left: [], reason: null };
  for (const f of feeds) {
    const r = await clearPushedBusy(db, f.id, http, now).catch((): ClearResult => ({ removed: 0, left: [], reason: "provider" }));
    cleanup.removed += r.removed;
    cleanup.left.push(...r.left);
    cleanup.reason ??= r.reason;
  }
  await executeCommand(actor, { command: how.command, householdId, idempotencyKey: randomUUID(), payload: how.payload });
  cleanup.left.sort((a, b) => a.start - b.start);
  return { cleanup };
}
