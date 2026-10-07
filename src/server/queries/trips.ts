import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { trips } from "@/db/schema";
import type { TripView } from "./week";

/** Time away that hasn't finished yet, soonest first. */
export async function upcomingTrips(db: Db, householdId: string, now = new Date()): Promise<TripView[]> {
  const rows = await db
    .select()
    .from(trips)
    .where(and(eq(trips.householdId, householdId), isNull(trips.cancelledAt), gt(trips.endAt, now)))
    .orderBy(trips.startAt)
    .limit(30);
  return rows.map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    destination: t.destination,
    start: t.startAt.getTime(),
    end: t.endAt.getTime(),
    travellerIds: t.travellerIds,
    childIds: t.childIds,
    organiserId: t.organiserId,
    version: t.version,
  }));
}
