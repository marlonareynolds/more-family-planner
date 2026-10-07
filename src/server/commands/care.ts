import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { careArrangements, careAsks, careRequirements, expenses, holidayPeriods } from "@/db/schema";
import { findConflicts } from "@/domain/availability";
import { assertCanConfirm } from "@/domain/care";
import { DomainError } from "@/domain/errors";
import { addDays, localToInstantCompatible } from "@/domain/time";
import { Temporal } from "@js-temporal/polyfill";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { loadBusy } from "../queries/busy";
import { assertPeople, dateString, release, requiredText, reserve, resolveSpan, shortText, spanSchema, timeString } from "./helpers";

/**
 * Holidays, childcare and handovers (spec 8.8). Arrangements use arbitrary
 * intervals; coverage is calculated per child and grouped for display.
 */

const holidayFields = z.object({
  name: requiredText(80, "A name"),
  startDate: dateString,
  /** Last day, inclusive. */
  endDate: dateString,
  dailyStart: timeString,
  dailyEnd: timeString,
  includeWeekends: z.boolean().default(false),
  childIds: z.array(z.uuid()).min(1, "Choose at least one child.").max(8),
});
type HolidayFields = z.infer<typeof holidayFields>;

interface DayRequirement {
  childId: string;
  start: number;
  end: number;
}

/** Expand a holiday into one requirement per child per day. */
export function holidayRequirements(h: HolidayFields, timeZone: string): DayRequirement[] {
  if (h.dailyEnd <= h.dailyStart) throw new DomainError("VALIDATION", "The care day must end after it starts.");
  const days = Temporal.PlainDate.from(h.endDate).since(Temporal.PlainDate.from(h.startDate)).days + 1;
  if (days < 1) throw new DomainError("VALIDATION", "The holiday must end on or after its first day.");
  if (days > 120) throw new DomainError("VALIDATION", "A holiday period can be up to 120 days.");
  const out: DayRequirement[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(h.startDate, i);
    const dow = Temporal.PlainDate.from(date).dayOfWeek;
    if (!h.includeWeekends && dow >= 6) continue;
    const start = localToInstantCompatible(`${date}T${h.dailyStart}`, timeZone);
    const end = localToInstantCompatible(`${date}T${h.dailyEnd}`, timeZone);
    for (const childId of h.childIds) out.push({ childId, start, end });
  }
  return out;
}

const reqKey = (r: { childId: string; start: number; end: number }) => `${r.childId}|${r.start}|${r.end}`;

export interface HolidayImpact {
  kept: number;
  added: number;
  removed: number;
  /** Removed requirements that had confirmed care or costs attached. */
  removedWithArrangements: number;
}

async function impactOf(tx: Tx, householdId: string, holidayId: string, next: DayRequirement[]) {
  const existing = await tx
    .select()
    .from(careRequirements)
    .where(and(eq(careRequirements.sourceType, "holiday"), eq(careRequirements.sourceId, holidayId)));
  const nextKeys = new Set(next.map(reqKey));
  const existingKeys = new Set(existing.map((r) => reqKey({ childId: r.childId, start: r.startAt.getTime(), end: r.endAt.getTime() })));
  const removed = existing.filter((r) => !nextKeys.has(reqKey({ childId: r.childId, start: r.startAt.getTime(), end: r.endAt.getTime() })));
  const added = next.filter((r) => !existingKeys.has(reqKey(r)));
  let removedWithArrangements = 0;
  for (const r of removed) {
    const [hit] = await tx
      .select({ id: careArrangements.id })
      .from(careArrangements)
      .where(
        and(
          eq(careArrangements.householdId, householdId),
          eq(careArrangements.state, "confirmed"),
          sql`${r.childId} = any(${careArrangements.childIds})`,
          lt(careArrangements.startAt, r.endAt),
          gt(careArrangements.endAt, r.startAt),
        ),
      )
      .limit(1);
    if (hit) removedWithArrangements++;
  }
  return {
    removed,
    added,
    impact: { kept: existing.length - removed.length, added: added.length, removed: removed.length, removedWithArrangements } satisfies HolidayImpact,
  };
}

export const createHoliday = defineCommand({
  name: "CreateHoliday",
  scope: "household",
  payload: holidayFields,
  async handler(ctx, p) {
    await assertPeople(ctx, [], p.childIds);
    const reqs = holidayRequirements(p, ctx.household.timeZone);
    const [h] = await ctx.tx
      .insert(holidayPeriods)
      .values({
        householdId: ctx.household.id,
        name: p.name,
        startDate: p.startDate,
        endDateExclusive: addDays(p.endDate, 1),
        dailyStart: p.dailyStart,
        dailyEnd: p.dailyEnd,
        includeWeekends: p.includeWeekends,
        childIds: p.childIds,
      })
      .returning();
    if (reqs.length) {
      await ctx.tx.insert(careRequirements).values(
        reqs.map((r) => ({
          householdId: ctx.household.id,
          childId: r.childId,
          startAt: new Date(r.start),
          endAt: new Date(r.end),
          reason: p.name,
          sourceType: "holiday" as const,
          sourceId: h.id,
        })),
      );
    }
    await ctx.bumpSchedule();
    await ctx.audit("holiday.create", "holiday", h.id);
    return { holidayId: h.id, days: reqs.length };
  },
});

/**
 * Edit a saved period through an impact preview: unchanged days keep their
 * arrangements, added days start unresolved, and removing days that have
 * confirmed care needs an explicit acknowledgement (spec 8.8).
 */
export const updateHoliday = defineCommand({
  name: "UpdateHoliday",
  scope: "household",
  payload: holidayFields.extend({
    holidayId: z.uuid(),
    version: z.number().int(),
    previewOnly: z.boolean().default(false),
    acknowledgeRemovedCare: z.boolean().default(false),
  }),
  async handler(ctx, p) {
    const [h] = await ctx.tx
      .select()
      .from(holidayPeriods)
      .where(and(eq(holidayPeriods.id, p.holidayId), eq(holidayPeriods.householdId, ctx.household.id)));
    assertVersion(h, p.version, "This holiday");
    await assertPeople(ctx, [], p.childIds);
    const next = holidayRequirements(p, ctx.household.timeZone);
    const { removed, added, impact } = await impactOf(ctx.tx, ctx.household.id, h.id, next);
    if (p.previewOnly) return { impact, applied: false };
    if (impact.removedWithArrangements > 0 && !p.acknowledgeRemovedCare) {
      throw new DomainError("CONFLICT", "Some removed days already have care arranged. Review them before saving.", { impact });
    }
    if (removed.length) await ctx.tx.delete(careRequirements).where(inArray(careRequirements.id, removed.map((r) => r.id)));
    if (added.length) {
      await ctx.tx.insert(careRequirements).values(
        added.map((r) => ({
          householdId: ctx.household.id,
          childId: r.childId,
          startAt: new Date(r.start),
          endAt: new Date(r.end),
          reason: p.name,
          sourceType: "holiday" as const,
          sourceId: h.id,
        })),
      );
    }
    await ctx.tx
      .update(holidayPeriods)
      .set({
        name: p.name,
        startDate: p.startDate,
        endDateExclusive: addDays(p.endDate, 1),
        dailyStart: p.dailyStart,
        dailyEnd: p.dailyEnd,
        includeWeekends: p.includeWeekends,
        childIds: p.childIds,
        version: sql`${holidayPeriods.version} + 1`,
      })
      .where(eq(holidayPeriods.id, h.id));
    await ctx.bumpSchedule();
    return { impact, applied: true };
  },
});

export const setHolidayArchived = defineCommand({
  name: "SetHolidayArchived",
  scope: "household",
  payload: z.object({ holidayId: z.uuid(), version: z.number().int(), archived: z.boolean() }),
  async handler(ctx, p) {
    const [h] = await ctx.tx
      .select()
      .from(holidayPeriods)
      .where(and(eq(holidayPeriods.id, p.holidayId), eq(holidayPeriods.householdId, ctx.household.id)));
    assertVersion(h, p.version, "This holiday");
    // Archive hides the period from planning; arrangements and costs are kept (AT-17).
    await ctx.tx
      .update(holidayPeriods)
      .set({ archivedAt: p.archived ? ctx.now : null, version: sql`${holidayPeriods.version} + 1` })
      .where(eq(holidayPeriods.id, h.id));
    return { holidayId: h.id };
  },
});

// ── Arrangements ───────────────────────────────────────────────────────────

async function assertParentFree(ctx: CommandContext, accountId: string, start: number, end: number, excludeId?: string) {
  const busy = await loadBusy(ctx.tx, ctx.household.id, { start: start - 86_400_000, end: end + 86_400_000 });
  const conflicts = findConflicts({ personIds: [accountId], start, end, excludeSourceIds: excludeId ? [excludeId] : [] }, busy, ctx.actor.accountId);
  if (conflicts.length) {
    throw new DomainError("CONFLICT", "That parent is busy for part of this time.", {
      conflicts: conflicts.map((c) => ({ code: c.code, start: c.start, end: c.end, title: c.title })),
    });
  }
}

export const arrangeCare = defineCommand({
  name: "ArrangeCare",
  scope: "household",
  payload: z.object({
    kind: z.enum(["parent", "external", "not_needed"]),
    responsibleAccountId: z.uuid().nullable().default(null),
    providerName: shortText(80).nullable().default(null),
    childIds: z.array(z.uuid()).min(1).max(8),
    span: spanSchema,
    note: shortText(500).default(""),
    /** For external care or "not needed": the family adult records it as confirmed. */
    confirmed: z.boolean().default(false),
  }),
  async handler(ctx, p) {
    if (p.kind === "parent" && !p.responsibleAccountId) throw new DomainError("VALIDATION", "Choose which parent.");
    if (p.kind === "external" && !p.providerName) throw new DomainError("VALIDATION", "Name the carer or club.");
    await assertPeople(ctx, p.kind === "parent" ? [p.responsibleAccountId!] : [], p.childIds);
    const span = resolveSpan(p.span, ctx.household.timeZone);
    // A parent's own offer is confirmed on the spot; another adult's
    // responsibility can only be proposed to them (AT-07).
    const selfConfirm = p.kind === "parent" ? p.responsibleAccountId === ctx.actor.accountId : p.confirmed;
    if (selfConfirm && p.kind === "parent") await assertParentFree(ctx, p.responsibleAccountId!, span.start, span.end);
    const [a] = await ctx.tx
      .insert(careArrangements)
      .values({
        householdId: ctx.household.id,
        kind: p.kind,
        responsibleAccountId: p.kind === "parent" ? p.responsibleAccountId : null,
        providerName: p.kind === "external" ? p.providerName : null,
        childIds: p.childIds,
        startAt: new Date(span.start),
        endAt: new Date(span.end),
        state: selfConfirm ? "confirmed" : "proposed",
        confirmedBy: selfConfirm ? ctx.actor.accountId : null,
        confirmedAt: selfConfirm ? ctx.now : null,
        createdBy: ctx.actor.accountId,
        note: p.note,
      })
      .returning();
    if (selfConfirm && p.kind === "parent") {
      // Parent care reserves that parent (INV-06).
      await reserve(ctx.tx, ctx.household.id, "care", a.id, [p.responsibleAccountId!], span.start, span.end);
    }
    if (p.kind === "parent" && !selfConfirm) {
      await ctx.emit("notify", `notify:care.asked:${a.id}:${a.version}:${p.responsibleAccountId}`, {
        recipientId: p.responsibleAccountId,
        kind: "care.asked",
        text: `${ctx.actor.displayName} asked if you can look after the children.`,
        sourceType: "care",
        sourceId: a.id,
        sourceVersion: a.version,
        householdId: ctx.household.id,
      });
    }
    await ctx.bumpSchedule();
    await ctx.audit("care.arrange", "care", a.id);
    if (a.state === "confirmed") await ctx.track("care_gap_resolved", p.kind);
    return { arrangementId: a.id, state: a.state };
  },
});

async function loadArrangement(ctx: CommandContext, id: string, version: number) {
  const [a] = await ctx.tx
    .select()
    .from(careArrangements)
    .where(and(eq(careArrangements.id, id), eq(careArrangements.householdId, ctx.household.id)));
  assertVersion(a, version, "This arrangement");
  return a;
}

export const respondToCare = defineCommand({
  name: "RespondToCare",
  scope: "household",
  payload: z.object({ arrangementId: z.uuid(), version: z.number().int(), decision: z.enum(["confirm", "decline"]) }),
  async handler(ctx, p) {
    const a = await loadArrangement(ctx, p.arrangementId, p.version);
    assertCanConfirm(a, ctx.actor.accountId);
    if (p.decision === "confirm") {
      if (a.kind === "parent") {
        await assertParentFree(ctx, a.responsibleAccountId!, a.startAt.getTime(), a.endAt.getTime(), a.id);
        await release(ctx.tx, "care", a.id);
        await reserve(ctx.tx, ctx.household.id, "care", a.id, [a.responsibleAccountId!], a.startAt.getTime(), a.endAt.getTime());
      }
      await ctx.tx
        .update(careArrangements)
        .set({ state: "confirmed", confirmedBy: ctx.actor.accountId, confirmedAt: ctx.now, version: sql`${careArrangements.version} + 1` })
        .where(eq(careArrangements.id, a.id));
    } else {
      // Declining a specific responsibility is separate from a general
      // capacity change; the gap reappears for the family to resolve (spec 8.3).
      await release(ctx.tx, "care", a.id);
      await ctx.tx
        .update(careArrangements)
        .set({ state: "declined", version: sql`${careArrangements.version} + 1` })
        .where(eq(careArrangements.id, a.id));
    }
    await ctx.bumpSchedule();
    await ctx.audit(`care.${p.decision}`, "care", a.id);
    if (p.decision === "confirm") await ctx.track("care_gap_resolved", a.kind);
    return { arrangementId: a.id };
  },
});

export const removeCare = defineCommand({
  name: "RemoveCare",
  scope: "household",
  payload: z.object({ arrangementId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const a = await loadArrangement(ctx, p.arrangementId, p.version);
    if (a.kind === "parent" && a.state === "confirmed") assertCanConfirm(a, ctx.actor.accountId);
    const [cost] = await ctx.tx
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.sourceType, "care"), eq(expenses.sourceId, a.id)));
    await release(ctx.tx, "care", a.id);
    if (cost) {
      // Keep the record (and its money history); mark it no longer relied on.
      await ctx.tx
        .update(careArrangements)
        .set({ state: "declined", version: sql`${careArrangements.version} + 1` })
        .where(eq(careArrangements.id, a.id));
    } else {
      if (a.state !== "confirmed") await ctx.tx.delete(careAsks).where(eq(careAsks.arrangementId, a.id));
      await ctx.tx.delete(careArrangements).where(and(eq(careArrangements.id, a.id), ne(careArrangements.state, "confirmed")));
      await ctx.tx
        .update(careArrangements)
        .set({ state: "declined", version: sql`${careArrangements.version} + 1` })
        .where(eq(careArrangements.id, a.id));
    }
    await ctx.bumpSchedule();
    return { arrangementId: a.id };
  },
});
