import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { moments } from "@/db/schema";
import { CATALOGUE, catalogueSeat } from "@/lib/catalogue";
import { placeActivities, type PlaceView } from "@/lib/places";
import { myShare, type Shelf } from "@/lib/private-split";

/**
 * For Us ideas already used by a current adult, and whose they are: the
 * first adult to make an idea into a plan keeps it on their shelf for good
 * (review R07). Server-side only, never sent to the browser, because it
 * would tell one partner what the other has planned.
 */
export async function claimedIdeas(db: DbOrTx, householdId: string, adultIds: readonly string[]): Promise<Record<string, string>> {
  if (adultIds.length < 2) return {};
  const rows = await db
    .select({ key: moments.activityKey, by: moments.organiserId })
    .from(moments)
    .where(and(eq(moments.householdId, householdId), eq(moments.kind, "us"), isNotNull(moments.activityKey), inArray(moments.organiserId, [...adultIds])))
    .orderBy(asc(moments.createdAt));
  const claimed: Record<string, string> = {};
  for (const r of rows) if (r.key && !(r.key in claimed)) claimed[r.key] = r.by;
  return claimed;
}

/** Everything needed to deal the viewer's For Us shelf. */
export async function usShelf(db: DbOrTx, householdId: string, viewerId: string, adultIds: readonly string[]): Promise<Shelf> {
  return { householdId, accountId: viewerId, adultIds, claimed: await claimedIdeas(db, householdId, adultIds) };
}

/**
 * The keys of every For Us idea on the viewer's shelf, places and starter
 * ideas alike, or null while they are the only adult (everything is theirs).
 * This is what the browser gets: the viewer's own shelf, nothing about the
 * partner's.
 */
export function usShelfKeys(shelf: Shelf, places: readonly PlaceView[]): string[] | null {
  if (new Set(shelf.adultIds).size < 2) return null;
  const own = myShare(placeActivities(places, "us"), (a) => a.key, shelf);
  const general = myShare(CATALOGUE.filter((a) => a.kind === "us"), (a) => a.key, shelf, (a) => catalogueSeat(a.key));
  return [...own, ...general].map((a) => a.key);
}
