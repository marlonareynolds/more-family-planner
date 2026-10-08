import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { deskItems, events, trips } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { WEEKDAYS } from "@/domain/recurrence";
import { defineCommand, type CommandContext } from "../pipeline";
import { deskItemInput, deskKeys, deskTargetAlive, type DeskItemInput } from "../desk";
import { createHoliday } from "./care";
import { addJob } from "./jobs";
import { addEvent, updateEvent } from "./schedule";
import { addTrip, updateTrip } from "./trips";

/**
 * Put what the person ticked on the Desk into the diary, all at once
 * (quality release, priority 4). One command, one transaction: an import
 * either lands whole or not at all, so nothing is left half-done. Each card
 * goes through the same command as its hand-made version, so sharing,
 * Me-time and care rules still apply. The household lock serialises two
 * adults importing the same notice, and the desk record means the second one
 * is told it is already there instead of adding it again.
 */

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const importItem = deskItemInput.extend({
  /** "add" a new card; "update" the entry it changed or moved from; "existing" names one already there, for linking. */
  action: z.enum(["add", "update", "existing"]),
  targetId: z.uuid().nullable().default(null),
  adultIds: z.array(z.uuid()).max(8).default([]),
  /** A deadline's cut-off, or "be there by" before the start. */
  arriveBy: time.nullable().default(null),
  repeat: z.enum(["weekly", "fortnightly", "monthly"]).nullable().default(null),
  repeatUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  /** Lines the Desk adds to the entry's notes: what was not stated, what was estimated. */
  notes: z.array(z.string().max(200)).max(6).default([]),
  /** For a job: who takes it on. */
  owner: z.enum(["me", "partner", "none"]).default("me"),
  /** For a job: the card (ref) of the diary item it belongs to. */
  forRef: z.string().max(20).nullable().default(null),
});
type ImportItem = z.infer<typeof importItem>;

export type ImportOutcome = { ref: string; outcome: "added" | "updated" | "already"; targetType: string; targetId: string; by?: string };

function weeksBetween(a: string, b: string): number {
  return Math.floor((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / (7 * 86_400_000));
}

function ruleOf(i: ImportItem) {
  if (!i.repeat || i.kind !== "event") return null;
  const day = WEEKDAYS[(new Date(`${i.startDate}T12:00:00Z`).getUTCDay() + 6) % 7];
  if (i.repeat === "monthly") {
    const months = i.repeatUntil ? (+i.repeatUntil.slice(0, 4) - +i.startDate.slice(0, 4)) * 12 + (+i.repeatUntil.slice(5, 7) - +i.startDate.slice(5, 7)) : null;
    return { freq: "MONTHLY" as const, ...(months !== null ? { count: Math.max(1, months + 1) } : {}) };
  }
  const interval = i.repeat === "fortnightly" ? 2 : 1;
  const count = i.repeatUntil ? Math.floor(weeksBetween(i.startDate, i.repeatUntil) / interval) + 1 : null;
  return { freq: "WEEKLY" as const, interval, byDay: [day], ...(count !== null ? { count: Math.min(500, Math.max(1, count)) } : {}) };
}

function eventFields(ctx: CommandContext, i: ImportItem) {
  const start = i.arriveBy && i.startTime && i.arriveBy < i.startTime ? i.arriveBy : i.startTime;
  const notes = [i.details, i.arriveBy && i.startTime && i.arriveBy < i.startTime ? `Arrive by ${i.arriveBy}; it starts at ${i.startTime}.` : "", ...i.notes].filter(Boolean).join("\n");
  const span =
    i.allDay || !start
      ? { allDay: true, startDate: i.startDate, endDate: i.endDate }
      : { allDay: false, startDate: i.startDate, startTime: start, endDate: i.endDate, endTime: i.endTime ?? start };
  return addEvent.payload.parse({
    title: i.title,
    notes: notes.slice(0, 2000),
    location: i.location,
    visibility: i.justMe ? "private" : "shared",
    span,
    adultIds: i.justMe ? [ctx.actor.accountId] : i.adultIds,
    childIds: i.childIds,
    rule: ruleOf(i),
  });
}

function tripFields(i: ImportItem) {
  return addTrip.payload.parse({
    title: i.title,
    destination: i.location.slice(0, 80),
    kind: i.childIds.length ? "family" : "personal",
    startDate: i.startDate,
    startTime: i.startTime ?? "09:00",
    endDate: i.endDate,
    endTime: i.endTime ?? "17:00",
    travellerIds: i.adultIds,
    childIds: i.childIds,
  });
}

type Target = { type: "event" | "trip" | "holiday" | "job"; id: string };

async function create(ctx: CommandContext, i: ImportItem, linked: Map<string, Target>): Promise<Target> {
  if (i.kind === "event") return { type: "event", id: (await addEvent.handler(ctx, eventFields(ctx, i))).eventId };
  if (i.kind === "trip") return { type: "trip", id: (await addTrip.handler(ctx, tripFields(i))).tripId };
  if (i.kind === "holiday") {
    const r = await createHoliday.handler(ctx, createHoliday.payload.parse({ name: i.title, startDate: i.startDate, endDate: i.endDate, dailyStart: "08:30", dailyEnd: "17:30", includeWeekends: false, childIds: i.childIds }));
    return { type: "holiday", id: r.holidayId };
  }
  const forItem = i.forRef ? linked.get(i.forRef) : undefined;
  const link = forItem && (forItem.type === "event" || forItem.type === "trip") ? { forType: forItem.type, forId: forItem.id } : { forType: null, forId: null };
  const r = await addJob.handler(
    ctx,
    addJob.payload.parse({
      title: i.title,
      notes: [i.details, ...i.notes].filter(Boolean).join("\n").slice(0, 500),
      cadence: "once",
      startsOn: i.startDate,
      dueTime: i.startTime,
      remindDayBefore: !i.startTime || i.startTime < "10:00",
      minutes: 10,
      owner: i.owner,
      ...link,
    }),
  );
  return { type: "job", id: r.jobId };
}

async function update(ctx: CommandContext, i: ImportItem, target: Target) {
  if (target.type === "event") {
    const [row] = await ctx.tx.select({ version: events.version }).from(events).where(eq(events.id, target.id));
    if (!row) throw new DomainError("NOT_FOUND", "That diary entry has gone. Add it as new instead.");
    await updateEvent.handler(ctx, updateEvent.payload.parse({ eventId: target.id, version: row.version, scope: "series", fields: eventFields(ctx, i) }));
    return;
  }
  if (target.type === "trip") {
    const [row] = await ctx.tx.select({ version: trips.version }).from(trips).where(eq(trips.id, target.id));
    if (!row) throw new DomainError("NOT_FOUND", "That trip has gone. Add it as new instead.");
    await updateTrip.handler(ctx, updateTrip.payload.parse({ ...tripFields(i), tripId: target.id, version: row.version }));
    return;
  }
  throw new DomainError("VALIDATION", "A changed school break or job is changed where it lives, in Trips and care or Jobs.");
}

export const importDeskItems = defineCommand({
  name: "ImportDeskItems",
  scope: "household",
  payload: z.object({ items: z.array(importItem).min(1).max(60) }),
  async handler(ctx, p) {
    const results: ImportOutcome[] = [];
    const linked = new Map<string, Target>();
    const scopeOf = (i: DeskItemInput) => (i.justMe ? ctx.actor.accountId : null);
    // Diary items first, so a job can be linked to the item it belongs to.
    const ordered = [...p.items].sort((a, b) => Number(a.kind === "job") - Number(b.kind === "job"));
    for (const i of ordered) {
      const k = await deskKeys(ctx.household.id, i, scopeOf(i));
      const [existing] = await ctx.tx.select().from(deskItems).where(and(eq(deskItems.householdId, ctx.household.id), eq(deskItems.identityKey, k.identityKey)));

      if (i.action === "existing") {
        if (existing) linked.set(i.ref, { type: existing.targetType, id: existing.targetId });
        continue;
      }

      if (i.action === "update") {
        if (!i.targetId) throw new DomainError("VALIDATION", "Say which entry to update.");
        const [row] = await ctx.tx.select().from(deskItems).where(and(eq(deskItems.householdId, ctx.household.id), eq(deskItems.targetId, i.targetId), eq(deskItems.seriesKey, k.seriesKey)));
        if (!row || (row.privateTo && row.privateTo !== ctx.actor.accountId)) throw new DomainError("NOT_FOUND", "That diary entry could not be found. Add it as new instead.");
        await update(ctx, i, { type: row.targetType, id: row.targetId });
        // A moved notice may land on a date another row already claims; that row is the older copy.
        if (existing && existing.id !== row.id) await ctx.tx.delete(deskItems).where(eq(deskItems.id, existing.id));
        await ctx.tx.update(deskItems).set({ identityKey: k.identityKey, detailKey: k.detailKey, startDate: i.startDate, updatedAt: ctx.now }).where(eq(deskItems.id, row.id));
        linked.set(i.ref, { type: row.targetType, id: row.targetId });
        results.push({ ref: i.ref, outcome: "updated", targetType: row.targetType, targetId: row.targetId });
        continue;
      }

      if (existing && (await deskTargetAlive(ctx.tx, existing.targetType, existing.targetId))) {
        // Already added (by either adult, or by a read that half-finished): never twice.
        linked.set(i.ref, { type: existing.targetType, id: existing.targetId });
        results.push({ ref: i.ref, outcome: "already", targetType: existing.targetType, targetId: existing.targetId });
        continue;
      }
      const target = await create(ctx, i, linked);
      const values = { identityKey: k.identityKey, seriesKey: k.seriesKey, detailKey: k.detailKey, targetType: target.type, targetId: target.id, startDate: i.startDate, privateTo: scopeOf(i), createdBy: ctx.actor.accountId, updatedAt: ctx.now };
      if (existing) await ctx.tx.update(deskItems).set(values).where(eq(deskItems.id, existing.id));
      else await ctx.tx.insert(deskItems).values({ householdId: ctx.household.id, ...values });
      linked.set(i.ref, target);
      results.push({ ref: i.ref, outcome: "added", targetType: target.type, targetId: target.id });
    }
    await ctx.audit("desk.import", null, null);
    return { results };
  },
});

