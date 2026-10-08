import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { events, trips } from "@/db/schema";

/**
 * The one place that decides whether a diary item may be linked to, or named
 * on, something else (a job "for" a trip). Always within the viewer's own
 * household, and an event only if that viewer may see it: shared, or their
 * own. A forged or stale id resolves to nothing, never to another
 * household's title.
 */
export async function linkedTitles(db: DbOrTx, householdId: string, viewerId: string, refs: { type: "event" | "trip"; id: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const eventIds = [...new Set(refs.filter((r) => r.type === "event").map((r) => r.id))];
  const tripIds = [...new Set(refs.filter((r) => r.type === "trip").map((r) => r.id))];
  if (eventIds.length) {
    const rows = await db
      .select({ id: events.id, title: events.title, visibility: events.visibility, ownerId: events.ownerId })
      .from(events)
      .where(and(inArray(events.id, eventIds), eq(events.householdId, householdId), isNull(events.cancelledAt)));
    for (const e of rows) if (e.visibility === "shared" || e.ownerId === viewerId) out.set(e.id, e.title);
  }
  if (tripIds.length) {
    const rows = await db.select({ id: trips.id, title: trips.title }).from(trips).where(and(inArray(trips.id, tripIds), eq(trips.householdId, householdId), isNull(trips.cancelledAt)));
    for (const t of rows) out.set(t.id, t.title);
  }
  return out;
}
