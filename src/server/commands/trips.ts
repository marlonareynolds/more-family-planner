import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { trips } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { localToInstantCompatible } from "@/domain/time";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { assertPeople, currentAdults, dateString, queueNotification, requiredText, shortText, timeString } from "./helpers";

/**
 * Time away (blueprint, Our Week): one entry for a work trip, a weekend away
 * or a family holiday. Travellers show as away, and the care it creates for
 * children at home is worked out on read, so it stays right as plans move.
 */

const tripFields = z.object({
  title: requiredText(80, "A name"),
  destination: shortText(80).default(""),
  kind: z.enum(["work", "personal", "family"]),
  startDate: dateString,
  startTime: timeString,
  endDate: dateString,
  endTime: timeString,
  travellerIds: z.array(z.uuid()).min(1, "Choose who is going.").max(8),
  childIds: z.array(z.uuid()).max(8).default([]),
});
type TripFields = z.infer<typeof tripFields>;

function spanOf(p: TripFields, timeZone: string) {
  const start = localToInstantCompatible(`${p.startDate}T${p.startTime}`, timeZone);
  const end = localToInstantCompatible(`${p.endDate}T${p.endTime}`, timeZone);
  if (!(end > start)) throw new DomainError("VALIDATION", "The trip must end after it starts.");
  if (end - start > 60 * 86_400_000) throw new DomainError("VALIDATION", "A trip can be up to 60 days.");
  return { startAt: new Date(start), endAt: new Date(end) };
}

async function tell(ctx: CommandContext, tripId: string, version: number, text: string, kind: string) {
  for (const a of await currentAdults(ctx.tx, ctx.household.id)) {
    if (a.id === ctx.actor.accountId) continue;
    await queueNotification(ctx, { recipientId: a.id, kind, text, sourceType: "trip", sourceId: tripId, sourceVersion: version });
  }
}

export const addTrip = defineCommand({
  name: "AddTrip",
  scope: "household",
  payload: tripFields,
  async handler(ctx, p) {
    await assertPeople(ctx, p.travellerIds, p.childIds);
    const span = spanOf(p, ctx.household.timeZone);
    const [row] = await ctx.tx
      .insert(trips)
      .values({ householdId: ctx.household.id, organiserId: ctx.actor.accountId, kind: p.kind, title: p.title, destination: p.destination, ...span, travellerIds: [...new Set(p.travellerIds)], childIds: [...new Set(p.childIds)] })
      .returning();
    await ctx.bumpSchedule();
    await ctx.audit("trip.add", "trip", row.id);
    await tell(ctx, row.id, row.version, `${ctx.actor.displayName} added time away: ${p.title}.`, "trip.added");
    return { tripId: row.id };
  },
});

export const updateTrip = defineCommand({
  name: "UpdateTrip",
  scope: "household",
  payload: tripFields.extend({ tripId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const [row] = await ctx.tx.select().from(trips).where(and(eq(trips.id, p.tripId), eq(trips.householdId, ctx.household.id), isNull(trips.cancelledAt)));
    assertVersion(row, p.version, "This trip");
    await assertPeople(ctx, p.travellerIds, p.childIds);
    const span = spanOf(p, ctx.household.timeZone);
    await ctx.tx
      .update(trips)
      .set({ kind: p.kind, title: p.title, destination: p.destination, ...span, travellerIds: [...new Set(p.travellerIds)], childIds: [...new Set(p.childIds)], version: sql`${trips.version} + 1` })
      .where(eq(trips.id, row.id));
    await ctx.bumpSchedule();
    await tell(ctx, row.id, row.version + 1, `${ctx.actor.displayName} changed the dates or people for ${p.title}.`, "trip.changed");
    return { tripId: row.id };
  },
});

export const cancelTrip = defineCommand({
  name: "CancelTrip",
  scope: "household",
  payload: z.object({ tripId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const [row] = await ctx.tx.select().from(trips).where(and(eq(trips.id, p.tripId), eq(trips.householdId, ctx.household.id), isNull(trips.cancelledAt)));
    assertVersion(row, p.version, "This trip");
    await ctx.tx.update(trips).set({ cancelledAt: ctx.now, version: sql`${trips.version} + 1` }).where(eq(trips.id, row.id));
    await ctx.bumpSchedule();
    await tell(ctx, row.id, row.version + 1, `${ctx.actor.displayName} cancelled ${row.title}.`, "trip.cancelled");
    return { tripId: row.id };
  },
});
