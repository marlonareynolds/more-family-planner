import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { children, deskItems, events, trips } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { expand, WEEKDAYS, type RecurrenceRule } from "@/domain/recurrence";
import { addDays, startOfLocalDate } from "@/domain/time";
import { diaryTimes } from "@/lib/desk-keys";
import { defineCommand, type CommandContext } from "../pipeline";
import { deskItemInput, deskKeys, deskTarget, type DeskItemInput } from "../desk";
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
  /** "add" a new card; "update" the entry it changed from; "existing" names one already there, for linking. */
  action: z.enum(["add", "update", "existing"]),
  targetId: z.uuid().nullable().default(null),
  /** The version of the entry the person saw when they chose "update": a newer one means look again. */
  targetVersion: z.number().int().nullable().default(null),
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
  /**
   * For a changed pickup: who collects. "partner" asks them, through the same
   * take-it-on request as any job; nothing says they will until they agree.
   */
  collect: z.enum(["me", "partner", "none"]).nullable().default(null),
  /** When the children must be collected, if the letter says. */
  collectAt: time.nullable().default(null),
});
type ImportItem = z.infer<typeof importItem>;

export type ImportOutcome = { ref: string; outcome: "added" | "updated" | "already"; targetType: string; targetId: string };

/**
 * A repeat that stops by a given date: counted from the actual occurrences,
 * so "monthly until 1 November" from 20 October is October only.
 */
function ruleOf(ctx: CommandContext, i: ImportItem): RecurrenceRule | null {
  if (!i.repeat || i.kind !== "event") return null;
  const day = WEEKDAYS[(new Date(`${i.startDate}T12:00:00Z`).getUTCDay() + 6) % 7];
  const rule: RecurrenceRule = i.repeat === "monthly" ? { freq: "MONTHLY" } : { freq: "WEEKLY", interval: i.repeat === "fortnightly" ? 2 : 1, byDay: [day] };
  if (!i.repeatUntil) return rule;
  if (i.repeatUntil < i.startDate) throw new DomainError("VALIDATION", `“${i.title}” stops repeating before it starts. Check the end date.`);
  const tz = ctx.household.timeZone;
  const n = expand(
    { localStart: `${i.startDate}T00:00`, timeZone: tz, allDay: true, durationMinutes: 1440, rule },
    { start: startOfLocalDate(i.startDate, tz), end: startOfLocalDate(addDays(i.repeatUntil, 1), tz) },
  ).length;
  return { ...rule, count: Math.min(500, Math.max(1, n)) };
}

/** The letter's lines for the notes, without repeating any already there. */
function letterNotes(i: ImportItem, existing = ""): string {
  const times = diaryTimes(i);
  const lines = [i.details, times.startTime && i.startTime && times.startTime !== i.startTime ? `Arrive by ${times.startTime}; it starts at ${i.startTime}.` : "", ...i.notes].filter(Boolean);
  return [existing, ...lines.filter((l) => !existing.includes(l))].filter(Boolean).join("\n").slice(0, 2000);
}

function spanOf(i: ImportItem) {
  const t = diaryTimes(i);
  return t.startTime === null ? { allDay: true, startDate: i.startDate, endDate: i.endDate } : { allDay: false, startDate: i.startDate, startTime: t.startTime, endDate: i.endDate, endTime: t.endTime ?? t.startTime };
}

function eventFields(ctx: CommandContext, i: ImportItem) {
  return addEvent.payload.parse({
    title: i.title,
    notes: letterNotes(i),
    location: i.location,
    visibility: i.justMe ? "private" : "shared",
    span: spanOf(i),
    // A pickup isn't anyone's until it's agreed: the collection job below holds who.
    adultIds: i.justMe ? [ctx.actor.accountId] : i.collect ? [] : i.adultIds,
    childIds: i.childIds,
    rule: ruleOf(ctx, i),
  });
}

function tripFields(i: ImportItem) {
  const t = diaryTimes(i);
  return addTrip.payload.parse({
    title: i.title,
    destination: i.location.slice(0, 80),
    kind: i.childIds.length ? "family" : "personal",
    startDate: i.startDate,
    startTime: t.startTime,
    endDate: i.endDate,
    endTime: t.endTime,
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
      notes: letterNotes(i).slice(0, 500),
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

/** The collection a changed pickup needs: a job, so asking the other adult is a request they answer. */
async function collection(ctx: CommandContext, i: ImportItem, event: Target) {
  const names = i.childIds.length ? (await ctx.tx.select({ name: children.preferredName }).from(children).where(inArray(children.id, i.childIds))).map((c) => c.name) : [];
  const at = i.collectAt ?? i.startTime;
  await addJob.handler(
    ctx,
    addJob.payload.parse({
      title: `Collect ${names.length ? names.join(" and ") : "the children"}${at ? ` at ${at}` : ""}`.slice(0, 80),
      notes: i.title,
      cadence: "once",
      startsOn: i.startDate,
      dueTime: at,
      remindDayBefore: true,
      minutes: 30,
      owner: i.collect,
      forType: "event",
      forId: event.id,
    }),
  );
}

/**
 * Bring an entry in line with a changed notice. Only what the letter decides
 * changes (title, dates and times, place, its own notes); who's going, travel
 * time, sharing and anything added by hand stay as they are. The person must
 * have seen the entry as it is now: a newer version means look again.
 */
async function update(ctx: CommandContext, i: ImportItem, target: Target) {
  const seen = await deskTarget(ctx.tx, ctx.household.id, ctx.actor.accountId, ctx.household.timeZone, target.type, target.id);
  if (!seen) throw new DomainError("NOT_FOUND", `“${i.title}” is no longer in the diary. Add it as new instead.`);
  if (i.targetVersion === null || seen.version !== i.targetVersion) {
    throw new DomainError("CONFLICT", `“${i.title}” was changed in the diary after you checked. Read the letter again to see it as it is now.`);
  }
  if (seen.recurring) throw new DomainError("VALIDATION", `“${i.title}” repeats. Change it in the diary, where you can choose which dates.`);
  if (target.type === "event") {
    const [row] = await ctx.tx.select().from(events).where(eq(events.id, target.id));
    const fields = addEvent.payload.parse({
      title: i.title,
      notes: letterNotes(i, row.notes),
      location: i.location || row.location,
      visibility: row.visibility,
      span: spanOf(i),
      adultIds: row.adultIds,
      childIds: row.childIds,
      travelBeforeMinutes: row.travelBeforeMinutes,
      travelAfterMinutes: row.travelAfterMinutes,
      rule: null,
    });
    await updateEvent.handler(ctx, updateEvent.payload.parse({ eventId: target.id, version: row.version, scope: "series", fields }));
    return;
  }
  if (target.type === "trip") {
    const [row] = await ctx.tx.select().from(trips).where(eq(trips.id, target.id));
    const f = tripFields(i);
    await updateTrip.handler(ctx, updateTrip.payload.parse({ ...f, kind: row.kind, destination: f.destination || row.destination, travellerIds: row.travellerIds, childIds: row.childIds, tripId: target.id, version: row.version }));
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
    const tz = ctx.household.timeZone;
    // Diary items first, so a job can be linked to the item it belongs to.
    const ordered = [...p.items].sort((a, b) => Number(a.kind === "job") - Number(b.kind === "job"));
    for (const i of ordered) {
      try {
        const k = await deskKeys(ctx.household.id, i, scopeOf(i));
        const [existing] = await ctx.tx.select().from(deskItems).where(and(eq(deskItems.householdId, ctx.household.id), eq(deskItems.identityKey, k.identityKey)));
        const visible = existing && (!existing.privateTo || existing.privateTo === ctx.actor.accountId) ? await deskTarget(ctx.tx, ctx.household.id, ctx.actor.accountId, tz, existing.targetType, existing.targetId) : null;

        if (i.action === "existing") {
          if (visible) linked.set(i.ref, { type: visible.targetType, id: visible.targetId });
          continue;
        }

        if (i.action === "update") {
          if (!i.targetId) throw new DomainError("VALIDATION", "Say which entry to update.");
          const [row] = await ctx.tx.select().from(deskItems).where(and(eq(deskItems.householdId, ctx.household.id), eq(deskItems.targetId, i.targetId), eq(deskItems.seriesKey, k.seriesKey)));
          if (!row || (row.privateTo && row.privateTo !== ctx.actor.accountId)) throw new DomainError("NOT_FOUND", `“${i.title}” could not be found in the diary. Add it as new instead.`);
          await update(ctx, i, { type: row.targetType, id: row.targetId });
          // A moved notice may land on a date another row already claims; that row is the older copy.
          if (existing && existing.id !== row.id) await ctx.tx.delete(deskItems).where(eq(deskItems.id, existing.id));
          await ctx.tx.update(deskItems).set({ identityKey: k.identityKey, detailKey: k.detailKey, startDate: i.startDate, updatedAt: ctx.now }).where(eq(deskItems.id, row.id));
          linked.set(i.ref, { type: row.targetType, id: row.targetId });
          results.push({ ref: i.ref, outcome: "updated", targetType: row.targetType, targetId: row.targetId });
          continue;
        }

        if (visible) {
          // Already added (by either adult, or by a read that half-finished): never twice.
          linked.set(i.ref, { type: visible.targetType, id: visible.targetId });
          results.push({ ref: i.ref, outcome: "already", targetType: visible.targetType, targetId: visible.targetId });
          continue;
        }
        const target = await create(ctx, i, linked);
        if (i.collect && target.type === "event") await collection(ctx, i, target);
        const values = { identityKey: k.identityKey, seriesKey: k.seriesKey, detailKey: k.detailKey, targetType: target.type, targetId: target.id, startDate: i.startDate, privateTo: scopeOf(i), createdBy: ctx.actor.accountId, updatedAt: ctx.now };
        if (existing) await ctx.tx.update(deskItems).set(values).where(eq(deskItems.id, existing.id));
        else await ctx.tx.insert(deskItems).values({ householdId: ctx.household.id, ...values });
        linked.set(i.ref, target);
        results.push({ ref: i.ref, outcome: "added", targetType: target.type, targetId: target.id });
      } catch (err) {
        // Nothing lands, and the person is told which card stopped it.
        if (err instanceof DomainError) throw new DomainError(err.code, err.message.includes(`“${i.title}”`) ? err.message : `“${i.title}”: ${err.message}`, { ...err.details, ref: i.ref });
        throw err;
      }
    }
    await ctx.audit("desk.import", null, null);
    return { results };
  },
});
