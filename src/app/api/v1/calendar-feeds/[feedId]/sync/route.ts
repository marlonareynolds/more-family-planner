import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { calendarFeeds } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { requireActor } from "@/server/auth";
import { syncFeed } from "@/server/calendar-sync";
import { assertSameOrigin, errorResponse, noStore } from "@/server/http";

export const maxDuration = 30;

/** Sync one of your own calendar links now. At most once every 30 seconds. */
export async function POST(req: Request, { params }: RouteContext<"/api/v1/calendar-feeds/[feedId]/sync">) {
  try {
    assertSameOrigin(req);
    const actor = await requireActor();
    const { feedId } = await params;
    const db = await getDb();
    const [feed] = await db
      .select({ id: calendarFeeds.id, lastAttemptAt: calendarFeeds.lastAttemptAt })
      .from(calendarFeeds)
      .where(and(eq(calendarFeeds.id, feedId), eq(calendarFeeds.accountId, actor.accountId)));
    if (!feed) throw new DomainError("NOT_FOUND", "That calendar could not be found.");
    if (feed.lastAttemptAt && Date.now() - feed.lastAttemptAt.getTime() < 30_000) {
      throw new DomainError("CONFLICT", "That calendar was just updated. Try again in a moment.");
    }
    const result = await syncFeed(db, feed.id);
    return Response.json(result, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
