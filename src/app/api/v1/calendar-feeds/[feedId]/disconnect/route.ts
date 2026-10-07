import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { calendarFeeds } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { requireActor } from "@/server/auth";
import { clearPushedBusy } from "@/server/calendar-sync";
import { executeCommand } from "@/server/commands";
import { assertSameOrigin, errorResponse, noStore } from "@/server/http";

export const maxDuration = 60;

/**
 * Disconnect one of your calendars. For a connected Google or Outlook
 * account, the "Busy" blocks More wrote are taken out first.
 */
export async function POST(req: Request, { params }: RouteContext<"/api/v1/calendar-feeds/[feedId]/disconnect">) {
  try {
    assertSameOrigin(req);
    const actor = await requireActor();
    const { feedId } = await params;
    const body = z.object({ version: z.number().int() }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new DomainError("VALIDATION", "Refresh and try again.");
    const db = await getDb();
    const [feed] = await db.select().from(calendarFeeds).where(and(eq(calendarFeeds.id, feedId), eq(calendarFeeds.accountId, actor.accountId)));
    if (!feed) throw new DomainError("NOT_FOUND", "That calendar could not be found.");
    // An expired grant can't remove them, and that mustn't trap the adult:
    // they disconnect anyway and are told exactly which blocks to delete.
    const cleanup = await clearPushedBusy(db, feed.id).catch(() => null);
    await executeCommand(actor, { command: "RemoveCalendarFeed", householdId: feed.householdId, idempotencyKey: randomUUID(), payload: { feedId: feed.id, version: body.data.version } });
    const cleared = !!cleanup && cleanup.left.length === 0;
    return Response.json({ removed: true, cleared, cleanup }, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
