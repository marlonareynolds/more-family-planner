import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { places } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { CATEGORIES } from "@/lib/catalogue";
import { defineCommand, assertVersion } from "../pipeline";
import { minor, requiredText, shortText } from "./helpers";

/**
 * Our places: local spots the household knows and likes. Nobody else's
 * reviews, nothing scraped; just what this family would recommend to itself.
 */

const placeFields = z.object({
  name: requiredText(80, "A name"),
  area: shortText(60).default(""),
  kinds: z.array(z.enum(["me", "us", "family"])).min(1, "Choose who it's good for.").max(3),
  category: z.enum(CATEGORIES),
  setting: z.enum(["home", "outdoors", "out-indoors"]),
  notes: shortText(300).default(""),
  typicalCostMinor: minor.default(0),
  durationMinutes: z.number().int().min(15).max(1440).default(120),
  stepFree: z.boolean().default(false),
  calm: z.boolean().default(false),
});

export const addPlace = defineCommand({
  name: "AddPlace",
  scope: "household",
  payload: placeFields,
  async handler(ctx, p) {
    const count = await ctx.tx.$count(places, and(eq(places.householdId, ctx.household.id), isNull(places.archivedAt)));
    if (count >= 100) throw new DomainError("VALIDATION", "Up to a hundred places can be saved.");
    const [row] = await ctx.tx
      .insert(places)
      .values({ ...p, kinds: [...new Set(p.kinds)], householdId: ctx.household.id, addedBy: ctx.actor.accountId })
      .returning();
    await ctx.audit("place.add", "place", row.id);
    await ctx.track("place_added");
    return { placeId: row.id };
  },
});

export const updatePlace = defineCommand({
  name: "UpdatePlace",
  scope: "household",
  payload: placeFields.extend({ placeId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const [row] = await ctx.tx.select().from(places).where(and(eq(places.id, p.placeId), eq(places.householdId, ctx.household.id), isNull(places.archivedAt)));
    assertVersion(row, p.version, "This place");
    const { placeId, version, ...fields } = p;
    void version;
    await ctx.tx.update(places).set({ ...fields, kinds: [...new Set(fields.kinds)], version: sql`${places.version} + 1` }).where(eq(places.id, placeId));
    return { placeId };
  },
});

export const archivePlace = defineCommand({
  name: "ArchivePlace",
  scope: "household",
  payload: z.object({ placeId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const [row] = await ctx.tx.select().from(places).where(and(eq(places.id, p.placeId), eq(places.householdId, ctx.household.id), isNull(places.archivedAt)));
    assertVersion(row, p.version, "This place");
    await ctx.tx.update(places).set({ archivedAt: ctx.now, version: sql`${places.version} + 1` }).where(eq(places.id, row.id));
    return { placeId: row.id };
  },
});
