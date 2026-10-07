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
import { assertPeople, currentAdults, dateString, release, requiredText, reserve, resolveSpan, shortText, spanSchema, timeString } from "./helpers";

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
      // Taking over from the other parent (R08): their promise ends only now
      // that someone has said yes, so the children are never left uncovered.
      const original = await replaced(ctx, a.replacesId);
      if (original) {
        await release(ctx.tx, "care", original.id);
        const [retired] = await ctx.tx.update(careArrangements).set({ state: "declined", version: sql`${careArrangements.version} + 1` }).where(eq(careArrangements.id, original.id)).returning();
        await notifyAdults(ctx, [original.responsibleAccountId!], "care.taken_over", retired, `${ctx.actor.displayName} will look after the children instead, ${await whenOf(ctx, original.startAt)}.`);
      }
    } else {
      const original = await replaced(ctx, a.replacesId);
      if (original) await notifyAdults(ctx, [original.responsibleAccountId!], "care.not_taken_over", original, `${ctx.actor.displayName} can't take over looking after the children, ${await whenOf(ctx, original.startAt)}. You're still down for it.`);
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
    await release(ctx.tx, "drop_off", a.id);
    await release(ctx.tx, "collect", a.id);
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

// ── Reviewing a promise, and named handovers (review R08) ─────────────────

/** The confirmed parent care a replacement would take over, if it still stands. */
async function replaced(ctx: CommandContext, id: string | null) {
  if (!id) return null;
  const [o] = await ctx.tx.select().from(careArrangements).where(and(eq(careArrangements.id, id), eq(careArrangements.householdId, ctx.household.id)));
  return o && o.state === "confirmed" && o.kind === "parent" ? o : null;
}

async function whenOf(ctx: CommandContext, at: Date): Promise<string> {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: ctx.household.timeZone }).format(at);
}

/** A neutral notice about shared logistics. It never carries anyone's private reason. */
async function notifyAdults(ctx: CommandContext, recipientIds: readonly string[], kind: string, a: { id: string; version: number }, text: string) {
  for (const recipientId of recipientIds) {
    if (recipientId === ctx.actor.accountId) continue;
    await ctx.emit("notify", `notify:${kind}:${a.id}:${a.version}:${recipientId}`, {
      recipientId,
      kind,
      text,
      sourceType: "care",
      sourceId: a.id,
      sourceVersion: a.version,
      householdId: ctx.household.id,
    });
  }
}

async function othersThan(ctx: CommandContext, accountId: string): Promise<string[]> {
  return (await currentAdults(ctx.tx, ctx.household.id)).map((a) => a.id).filter((id) => id !== accountId);
}

/**
 * The named parent looks again at care they promised (R08). Only they can,
 * and only for care still ahead. Nothing here is inferred from a check-in:
 * the choice is theirs, and no reason is asked for or passed on.
 * - keep: nothing changes, and nobody is told.
 * - hand_over: the other adult is asked to take it over. The original promise
 *   stands until they say yes, so the children are never left uncovered.
 * - withdraw: the promise ends now, the gap shows again for the family, and
 *   the other adult is told the care is needed again.
 */
export const reviewCare = defineCommand({
  name: "ReviewCare",
  scope: "household",
  payload: z.object({ arrangementId: z.uuid(), version: z.number().int(), choice: z.enum(["keep", "hand_over", "withdraw"]) }),
  async handler(ctx, p) {
    const a = await loadArrangement(ctx, p.arrangementId, p.version);
    if (a.kind !== "parent" || a.responsibleAccountId !== ctx.actor.accountId) throw new DomainError("FORBIDDEN", "Only the parent looking after the children can change this.");
    if (a.state !== "confirmed") throw new DomainError("VALIDATION", "This care isn't agreed yet.");
    if (a.endAt.getTime() <= ctx.now.getTime()) throw new DomainError("VALIDATION", "This care has already happened.");
    if (p.choice === "keep") return { arrangementId: a.id, state: a.state };

    const when = await whenOf(ctx, a.startAt);
    if (p.choice === "hand_over") {
      const [partner] = await othersThan(ctx, ctx.actor.accountId);
      if (!partner) throw new DomainError("VALIDATION", "There's no one else in the household to ask.");
      const [open] = await ctx.tx
        .select({ id: careArrangements.id })
        .from(careArrangements)
        .where(and(eq(careArrangements.replacesId, a.id), eq(careArrangements.state, "proposed")));
      if (open) return { arrangementId: a.id, replacementId: open.id, state: a.state };
      const [r] = await ctx.tx
        .insert(careArrangements)
        .values({
          householdId: ctx.household.id,
          kind: "parent",
          responsibleAccountId: partner,
          childIds: a.childIds,
          startAt: a.startAt,
          endAt: a.endAt,
          state: "proposed",
          createdBy: ctx.actor.accountId,
          replacesId: a.id,
        })
        .returning();
      await notifyAdults(ctx, [partner], "care.asked", r, `${ctx.actor.displayName} asked if you can look after the children instead, ${when}.`);
      await ctx.bumpSchedule();
      await ctx.audit("care.hand_over", "care", a.id);
      return { arrangementId: a.id, replacementId: r.id, state: a.state };
    }

    await release(ctx.tx, "care", a.id);
    const [w] = await ctx.tx.update(careArrangements).set({ state: "declined", version: sql`${careArrangements.version} + 1` }).where(eq(careArrangements.id, a.id)).returning();
    await notifyAdults(ctx, await othersThan(ctx, ctx.actor.accountId), "care.withdrawn", w, `${ctx.actor.displayName} can no longer look after the children, ${when}. Care is needed again.`);
    await ctx.bumpSchedule();
    await ctx.audit("care.withdraw", "care", a.id);
    return { arrangementId: a.id, state: w.state };
  },
});

const LEG_LABEL = { drop_off: "drop-off", collect: "collection" } as const;
type Leg = keyof typeof LEG_LABEL;

/** A handover occupies its adult for the journey there and back. */
function legWindow(a: { startAt: Date; endAt: Date; handoverMinutes: number }, leg: Leg) {
  const at = (leg === "drop_off" ? a.startAt : a.endAt).getTime();
  const m = a.handoverMinutes * 60_000;
  return { start: at - m, end: at + m };
}

function legFields(leg: Leg, by: string | null, agreed: boolean) {
  return leg === "drop_off" ? { dropOffBy: by, dropOffAgreed: agreed } : { collectBy: by, collectAgreed: agreed };
}

/**
 * Named handovers for care by someone outside the household: who takes the
 * children there and who collects them. Naming yourself agrees on the spot;
 * naming the other adult asks them. Either way it reserves the journey, so a
 * clash shows up like any other.
 */
export const setHandover = defineCommand({
  name: "SetHandover",
  scope: "household",
  payload: z.object({
    arrangementId: z.uuid(),
    version: z.number().int(),
    leg: z.enum(["drop_off", "collect"]),
    accountId: z.uuid().nullable(),
    minutes: z.number().int().min(0).max(120).optional(),
  }),
  async handler(ctx, p) {
    const a = await loadArrangement(ctx, p.arrangementId, p.version);
    if (a.kind !== "external" || a.state === "declined") throw new DomainError("VALIDATION", "Drop-off and collection are for care by someone outside the household.");
    if (p.accountId) await assertPeople(ctx, [p.accountId], []);
    const before = p.leg === "drop_off" ? { by: a.dropOffBy, agreed: a.dropOffAgreed } : { by: a.collectBy, agreed: a.collectAgreed };
    const minutes = p.minutes ?? a.handoverMinutes;
    const win = legWindow({ ...a, handoverMinutes: minutes }, p.leg);
    await release(ctx.tx, p.leg, a.id);
    const self = p.accountId === ctx.actor.accountId;
    if (self) {
      await assertParentFree(ctx, ctx.actor.accountId, win.start, win.end, a.id);
      await reserve(ctx.tx, ctx.household.id, p.leg, a.id, [ctx.actor.accountId], win.start, win.end);
    }
    const [u] = await ctx.tx
      .update(careArrangements)
      .set({ ...legFields(p.leg, p.accountId, self), handoverMinutes: minutes, version: sql`${careArrangements.version} + 1` })
      .where(eq(careArrangements.id, a.id))
      .returning();
    const when = await whenOf(ctx, p.leg === "drop_off" ? a.startAt : a.endAt);
    if (p.accountId && !self) {
      await notifyAdults(ctx, [p.accountId], "care.handover_asked", u, `${ctx.actor.displayName} asked if you can do the ${LEG_LABEL[p.leg]}, ${when}.`);
    } else if (before.by === ctx.actor.accountId && before.agreed && !self) {
      // Stepping back from a handover you'd agreed: the others need to know.
      await notifyAdults(ctx, await othersThan(ctx, ctx.actor.accountId), "care.handover_dropped", u, `${ctx.actor.displayName} can't do the ${LEG_LABEL[p.leg]} any more, ${when}. Someone is still needed.`);
    }
    await ctx.bumpSchedule();
    return { arrangementId: a.id };
  },
});

export const respondToHandover = defineCommand({
  name: "RespondToHandover",
  scope: "household",
  payload: z.object({ arrangementId: z.uuid(), version: z.number().int(), leg: z.enum(["drop_off", "collect"]), decision: z.enum(["agree", "decline"]) }),
  async handler(ctx, p) {
    const a = await loadArrangement(ctx, p.arrangementId, p.version);
    const by = p.leg === "drop_off" ? a.dropOffBy : a.collectBy;
    const agreed = p.leg === "drop_off" ? a.dropOffAgreed : a.collectAgreed;
    if (by !== ctx.actor.accountId || agreed || a.state === "declined") throw new DomainError("FORBIDDEN", "This isn't waiting for you.");
    const when = await whenOf(ctx, p.leg === "drop_off" ? a.startAt : a.endAt);
    if (p.decision === "agree") {
      const win = legWindow(a, p.leg);
      await assertParentFree(ctx, ctx.actor.accountId, win.start, win.end, a.id);
      await reserve(ctx.tx, ctx.household.id, p.leg, a.id, [ctx.actor.accountId], win.start, win.end);
    }
    const [u] = await ctx.tx
      .update(careArrangements)
      .set({ ...(p.decision === "agree" ? legFields(p.leg, by, true) : legFields(p.leg, null, false)), version: sql`${careArrangements.version} + 1` })
      .where(eq(careArrangements.id, a.id))
      .returning();
    if (p.decision === "decline") await notifyAdults(ctx, await othersThan(ctx, ctx.actor.accountId), "care.handover_declined", u, `${ctx.actor.displayName} can't do the ${LEG_LABEL[p.leg]}, ${when}. Someone is still needed.`);
    await ctx.bumpSchedule();
    return { arrangementId: a.id };
  },
});
