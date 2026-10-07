import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { moments, rituals } from "@/db/schema";
import { cadenceLabel } from "@/domain/rituals";
import { DomainError } from "@/domain/errors";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { generateRitual } from "../rituals";
import { assertPeople, dateString, minor, queueNotification, release, requiredText, shortText, supersedeDeliveries, timeString } from "./helpers";

/**
 * Rituals (spec 8.7, "plans that repeat"). A ritual is agreed once by
 * everyone in it; after that its dates appear as ordinary plans.
 */

async function loadRitual(ctx: CommandContext, id: string) {
  const [r] = await ctx.tx.select().from(rituals).where(and(eq(rituals.id, id), eq(rituals.householdId, ctx.household.id)));
  if (!r) throw new DomainError("NOT_FOUND", "That ritual could not be found.");
  return r;
}

export const startRitual = defineCommand({
  name: "StartRitual",
  scope: "household",
  payload: z.object({
    kind: z.enum(["me", "us", "family"]),
    title: requiredText(120, "A name"),
    notes: shortText(1000).default(""),
    activityKey: z.string().max(80).nullable().default(null),
    participantIds: z.array(z.uuid()).min(1).max(2),
    childIds: z.array(z.uuid()).max(8).default([]),
    needsCare: z.boolean().default(false),
    budgetMinor: minor.nullable().default(null),
    cadence: z.enum(["weekly", "fortnightly", "monthly"]),
    startsOn: dateString,
    startTime: timeString,
    durationMinutes: z.number().int().min(15).max(1440),
  }),
  async handler(ctx, p) {
    const participants = p.kind === "me" ? [ctx.actor.accountId] : p.participantIds;
    if (!participants.includes(ctx.actor.accountId)) throw new DomainError("VALIDATION", "Include yourself in this ritual.");
    if (p.kind === "us" && participants.length !== 2) throw new DomainError("VALIDATION", "A ritual for the two of you needs both adults.");
    await assertPeople(ctx, participants, p.childIds);
    const [r] = await ctx.tx
      .insert(rituals)
      .values({ ...p, householdId: ctx.household.id, organiserId: ctx.actor.accountId, participantIds: participants, agreedBy: [ctx.actor.accountId] })
      .returning();
    for (const other of participants.filter((id) => id !== ctx.actor.accountId)) {
      await queueNotification(ctx, {
        recipientId: other,
        kind: "ritual.invited",
        text: `${ctx.actor.displayName} suggested something to do ${cadenceLabel(p.cadence, p.startsOn).toLowerCase()}.`,
        sourceType: "ritual",
        sourceId: r.id,
        sourceVersion: r.version,
      });
    }
    const created = await generateRitual(ctx.tx, ctx.household, r, ctx.now);
    await ctx.audit("ritual.start", "ritual", r.id);
    await ctx.track("ritual_started", p.kind);
    return { ritualId: r.id, created };
  },
});

export const joinRitual = defineCommand({
  name: "JoinRitual",
  scope: "household",
  payload: z.object({ ritualId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const r = await loadRitual(ctx, p.ritualId);
    assertVersion(r, p.version, "This ritual");
    if (r.endedAt) throw new DomainError("CONFLICT", "This ritual has ended.");
    if (!r.participantIds.includes(ctx.actor.accountId)) throw new DomainError("NOT_FOUND", "That ritual could not be found.");
    const [updated] = await ctx.tx
      .update(rituals)
      .set({ agreedBy: [...new Set([...r.agreedBy, ctx.actor.accountId])], version: sql`${rituals.version} + 1` })
      .where(eq(rituals.id, r.id))
      .returning();
    for (const other of r.participantIds.filter((id) => id !== ctx.actor.accountId)) {
      await queueNotification(ctx, { recipientId: other, kind: "ritual.joined", text: `${ctx.actor.displayName} is in. The next dates are in the diary.`, sourceType: "ritual", sourceId: r.id, sourceVersion: updated.version });
    }
    const created = await generateRitual(ctx.tx, ctx.household, updated, ctx.now);
    await ctx.audit("ritual.join", "ritual", r.id);
    return { ritualId: r.id, created };
  },
});

/** Stop a ritual: its future dates are cancelled, past ones stay as they were. */
export const endRitual = defineCommand({
  name: "EndRitual",
  scope: "household",
  payload: z.object({ ritualId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const r = await loadRitual(ctx, p.ritualId);
    assertVersion(r, p.version, "This ritual");
    if (!r.participantIds.includes(ctx.actor.accountId)) throw new DomainError("NOT_FOUND", "That ritual could not be found.");
    if (r.endedAt) return { ritualId: r.id };
    await endRitualRow(ctx, r.id);
    for (const other of r.participantIds.filter((id) => id !== ctx.actor.accountId)) {
      await queueNotification(ctx, { recipientId: other, kind: "ritual.ended", text: `${ctx.actor.displayName} stopped a repeating plan.`, sourceType: "ritual", sourceId: r.id, sourceVersion: r.version + 1 });
    }
    await ctx.audit("ritual.end", "ritual", r.id);
    return { ritualId: r.id };
  },
});

export async function endRitualRow(ctx: CommandContext, ritualId: string): Promise<void> {
  await ctx.tx.update(rituals).set({ endedAt: ctx.now, version: sql`${rituals.version} + 1` }).where(eq(rituals.id, ritualId));
  const future = await ctx.tx
    .select({ id: moments.id })
    .from(moments)
    .where(and(eq(moments.ritualId, ritualId), gt(moments.startAt, ctx.now), inArray(moments.lifecycle, ["draft", "planned"])));
  for (const m of future) {
    await release(ctx.tx, "moment", m.id);
    await supersedeDeliveries(ctx.tx, m.id);
    await ctx.tx.update(moments).set({ lifecycle: "cancelled", version: sql`${moments.version} + 1` }).where(eq(moments.id, m.id));
  }
  await ctx.bumpSchedule();
}
