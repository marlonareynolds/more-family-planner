import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { places } from "@/db/schema";
import type { Category } from "@/lib/catalogue";
import type { PlaceView } from "@/lib/places";

export async function placesFor(db: DbOrTx, householdId: string): Promise<PlaceView[]> {
  const rows = await db.select().from(places).where(and(eq(places.householdId, householdId), isNull(places.archivedAt))).orderBy(places.name);
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    area: p.area,
    kinds: p.kinds as PlaceView["kinds"],
    category: p.category as Category,
    setting: p.setting,
    notes: p.notes,
    typicalCostMinor: p.typicalCostMinor,
    durationMinutes: p.durationMinutes,
    stepFree: p.stepFree,
    calm: p.calm,
    version: p.version,
  }));
}
