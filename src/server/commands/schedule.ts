import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { eventExceptions, events } from "@/db/schema";
import type { Tx } from "@/db/client";
import { DomainError } from "@/domain/errors";
import {
  expand,
  isOccurrence,
  splitSeries,
  validateRule,
  WEEKDAYS,
  type RecurrenceRule,
  type SeriesDefinition,
} from "@/domain/recurrence";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { assertOwnTimeRespected } from "./me-guard";
import { assertPeople, resolveSpan, shortText, spanSchema, requiredText, type ResolvedSpan } from "./helpers";

/**
 * Our Week: one event editor with one rule set (spec 8.4). Recurring series
 * support "this occurrence", "this and future" and "whole series".
 */

const ruleSchema = z.object({
  freq: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  interval: z.number().int().min(1).max(52).optional(),
  byDay: z.array(z.enum(WEEKDAYS)).min(1).max(7).optional(),
  count: z.number().int().min(1).max(500).optional(),
});

const eventFields = z.object({
  title: requiredText(120, "A title"),
  notes: shortText(2000).default(""),
  location: shortText(200).default(""),
  visibility: z.enum(["shared", "busy_only", "private"]).default("shared"),
  span: spanSchema,
  adultIds: z.array(z.uuid()).max(2).default([]),
  childIds: z.array(z.uuid()).max(8).default([]),
  travelBeforeMinutes: z.number().int().min(0).max(600).default(0),
  travelAfterMinutes: z.number().int().min(0).max(600).default(0),
  rule: ruleSchema.nullable().default(null),
});
type EventFields = z.infer<typeof eventFields>;

type EventRow = typeof events.$inferSelect;

export function seriesOf(row: Pick<EventRow, "localStart" | "timeZone" | "allDay" | "durationMinutes" | "rule">): SeriesDefinition {
  return {
    localStart: row.localStart,
    timeZone: row.timeZone,
    allDay: row.allDay,
    durationMinutes: row.durationMinutes,
    rule: row.rule as RecurrenceRule,
  };
}

/** Exclusive upper bound of any occurrence, or null for open-ended series. */
function seriesEnd(def: SeriesDefinition, span: ResolvedSpan): Date | null {
  if (!def.rule) return new Date(span.end);
  if (def.rule.count === undefined && !def.rule.endsBefore) return null;
  const occ = expand(def, { start: span.start, end: span.start + 60 * 366 * 86_400_000 });
  return new Date(occ.at(-1)?.end ?? span.end);
}

function rowValues(ctx: CommandContext, f: EventFields) {
  const span = resolveSpan(f.span, ctx.household.timeZone);
  const def: SeriesDefinition = {
    localStart: span.localStart,
    timeZone: ctx.household.timeZone,
    allDay: span.allDay,
    durationMinutes: span.durationMinutes,
    rule: f.rule as RecurrenceRule,
  };
  if (f.rule) validateRule(def);
  return {
    title: f.title,
    notes: f.notes,
    location: f.location,
    visibility: f.visibility,
    allDay: span.allDay,
    timeZone: ctx.household.timeZone,
    startAt: new Date(span.start),
    endAt: new Date(span.end),
    localStart: span.localStart,
    durationMinutes: span.durationMinutes,
    rule: f.rule,
    seriesEndAt: seriesEnd(def, span),
    travelBeforeMinutes: f.travelBeforeMinutes,
    travelAfterMinutes: f.travelAfterMinutes,
    adultIds: f.adultIds,
    childIds: f.childIds,
  };
}

/** The times an event will take, for the next few months, to check against others' own time. */
function spansOf(ctx: CommandContext, v: ReturnType<typeof rowValues>) {
  if (!v.rule) return [{ start: v.startAt.getTime(), end: v.endAt.getTime() }];
  const def: SeriesDefinition = { localStart: v.localStart, timeZone: v.timeZone, allDay: v.allDay, durationMinutes: v.durationMinutes, rule: v.rule as RecurrenceRule };
  return expand(def, { start: ctx.now.getTime(), end: ctx.now.getTime() + 120 * 86_400_000 });
}

async function loadEvent(ctx: CommandContext, eventId: string): Promise<EventRow> {
  const [row] = await ctx.tx.select().from(events).where(and(eq(events.id, eventId), eq(events.householdId, ctx.household.id)));
  if (!row || row.cancelledAt) throw new DomainError("NOT_FOUND", "That event could not be found.");
  if (row.feedId) throw new DomainError("CONFLICT", "This comes from a connected calendar. Change it there and it will update here.");
  // Private and busy-only items can only be changed by their owner.
  if (row.visibility !== "shared" && row.ownerId !== ctx.actor.accountId) {
    throw new DomainError("NOT_FOUND", "That event could not be found.");
  }
  return row;
}

export const addEvent = defineCommand({
  name: "AddEvent",
  scope: "household",
  payload: eventFields,
  async handler(ctx, p) {
    await assertPeople(ctx, p.adultIds, p.childIds);
    const values = rowValues(ctx, p);
    await assertOwnTimeRespected(ctx, p.adultIds, spansOf(ctx, values));
    const [row] = await ctx.tx
      .insert(events)
      .values({ householdId: ctx.household.id, ownerId: ctx.actor.accountId, ...values })
      .returning({ id: events.id, version: events.version });
    await ctx.bumpSchedule();
    await ctx.audit("event.add", "event", row.id);
    return { eventId: row.id, version: row.version };
  },
});

const scope = z.enum(["series", "occurrence", "future"]);

export const updateEvent = defineCommand({
  name: "UpdateEvent",
  scope: "household",
  payload: z.object({
    eventId: z.uuid(),
    version: z.number().int(),
    scope: scope.default("series"),
    recurrenceId: z.string().optional(),
    fields: eventFields,
  }),
  async handler(ctx, p) {
    const row = await loadEvent(ctx, p.eventId);
    assertVersion(row, p.version, "This event");
    await assertPeople(ctx, p.fields.adultIds, p.fields.childIds);
    const values = rowValues(ctx, p.fields);
    // Only people newly added need asking; anyone already in it agreed before.
    await assertOwnTimeRespected(ctx, p.fields.adultIds.filter((id) => !row.adultIds.includes(id) || values.startAt.getTime() !== row.startAt.getTime() || values.endAt.getTime() !== row.endAt.getTime()), spansOf(ctx, values));
    if (row.visibility !== "shared" || p.fields.visibility !== "shared") {
      if (row.ownerId !== ctx.actor.accountId) throw new DomainError("NOT_FOUND", "That event could not be found.");
    }

    if (!row.rule || p.scope === "series") {
      await ctx.tx.update(events).set({ ...values, version: sql`${events.version} + 1` }).where(eq(events.id, row.id));
      if (row.rule && values.localStart !== row.localStart) {
        // Moving a whole series re-anchors it: old occurrence exceptions no longer line up.
        await ctx.tx.delete(eventExceptions).where(eq(eventExceptions.eventId, row.id));
      }
      await ctx.bumpSchedule();
      return { eventId: row.id };
    }

    const recurrenceId = requireOccurrence(row, p.recurrenceId);
    if (p.scope === "occurrence") {
      // An occurrence change is an exception keyed to its original time,
      // even after it moves to another week (spec 11.2).
      await ctx.tx
        .insert(eventExceptions)
        .values({ eventId: row.id, recurrenceId, kind: "moved", startAt: values.startAt, endAt: values.endAt })
        .onConflictDoUpdate({
          target: [eventExceptions.eventId, eventExceptions.recurrenceId],
          set: { kind: "moved", startAt: values.startAt, endAt: values.endAt },
        });
      await ctx.tx.update(events).set({ version: sql`${events.version} + 1` }).where(eq(events.id, row.id));
      await ctx.bumpSchedule();
      return { eventId: row.id };
    }

    // "This and future": end the original series and start a new one.
    const newId = await splitInto(ctx.tx, row, recurrenceId, values);
    await ctx.bumpSchedule();
    return { eventId: newId };
  },
});

function requireOccurrence(row: EventRow, recurrenceId: string | undefined): string {
  if (!recurrenceId || !isOccurrence(seriesOf(row), recurrenceId)) {
    throw new DomainError("VALIDATION", "Choose which date of the repeating event to change.");
  }
  return recurrenceId;
}

async function splitInto(tx: Tx, row: EventRow, recurrenceId: string, values: ReturnType<typeof rowValues>): Promise<string> {
  const def = seriesOf(row);
  const { before } = splitSeries(def, recurrenceId);
  const [first] = expand(before, { start: row.startAt.getTime(), end: row.startAt.getTime() + 1 });
  const beforeEnd = expand(before, { start: row.startAt.getTime(), end: row.startAt.getTime() + 60 * 366 * 86_400_000 }).at(-1)?.end;
  await tx
    .update(events)
    .set({
      rule: before.rule,
      seriesEndAt: beforeEnd ? new Date(beforeEnd) : first ? new Date(first.end) : row.startAt,
      version: sql`${events.version} + 1`,
    })
    .where(eq(events.id, row.id));
  const [created] = await tx
    .insert(events)
    .values({ ...values, householdId: row.householdId, ownerId: row.ownerId, splitFromId: row.id })
    .returning({ id: events.id });
  // Exceptions at or after the cutover belong to the new series when they still line up.
  const later = await tx.select().from(eventExceptions).where(and(eq(eventExceptions.eventId, row.id), gt(eventExceptions.recurrenceId, recurrenceId)));
  const newDef: SeriesDefinition = { ...def, localStart: values.localStart, durationMinutes: values.durationMinutes, rule: values.rule as RecurrenceRule };
  for (const ex of later) {
    await tx.delete(eventExceptions).where(and(eq(eventExceptions.eventId, row.id), eq(eventExceptions.recurrenceId, ex.recurrenceId)));
    if (values.rule && isOccurrence(newDef, ex.recurrenceId)) await tx.insert(eventExceptions).values({ ...ex, eventId: created.id });
  }
  return created.id;
}

export const deleteEvent = defineCommand({
  name: "DeleteEvent",
  scope: "household",
  payload: z.object({
    eventId: z.uuid(),
    version: z.number().int(),
    scope: scope.default("series"),
    recurrenceId: z.string().optional(),
  }),
  async handler(ctx, p) {
    const row = await loadEvent(ctx, p.eventId);
    assertVersion(row, p.version, "This event");
    if (!row.rule || p.scope === "series") {
      await ctx.tx.update(events).set({ cancelledAt: ctx.now, version: sql`${events.version} + 1` }).where(eq(events.id, row.id));
    } else if (p.scope === "occurrence") {
      const recurrenceId = requireOccurrence(row, p.recurrenceId);
      await ctx.tx
        .insert(eventExceptions)
        .values({ eventId: row.id, recurrenceId, kind: "cancelled" })
        .onConflictDoUpdate({ target: [eventExceptions.eventId, eventExceptions.recurrenceId], set: { kind: "cancelled", startAt: null, endAt: null } });
      await ctx.tx.update(events).set({ version: sql`${events.version} + 1` }).where(eq(events.id, row.id));
    } else {
      const recurrenceId = requireOccurrence(row, p.recurrenceId);
      const { before } = splitSeries(seriesOf(row), recurrenceId);
      const last = expand(before, { start: row.startAt.getTime(), end: row.startAt.getTime() + 60 * 366 * 86_400_000 }).at(-1);
      if (!last) {
        await ctx.tx.update(events).set({ cancelledAt: ctx.now, version: sql`${events.version} + 1` }).where(eq(events.id, row.id));
      } else {
        await ctx.tx
          .update(events)
          .set({ rule: before.rule, seriesEndAt: new Date(last.end), version: sql`${events.version} + 1` })
          .where(eq(events.id, row.id));
      }
    }
    await ctx.bumpSchedule();
    await ctx.audit("event.delete", "event", row.id);
    return { eventId: row.id };
  },
});
