import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { acceptances, childWishes, expenses, feedback, highlights, moments, preparationTasks, weekPlans } from "@/db/schema";
import { findConflicts } from "@/domain/availability";
import { plansWith, whenPhrase } from "@/domain/discreet";
import { DomainError } from "@/domain/errors";
import { isAgreed, materialChanges, type AcceptanceRecord, type MomentFields } from "@/domain/moments";
import { instantToLocalDate, isWeekKey } from "@/domain/time";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { loadBusy } from "../queries/busy";
import { arrangeCare } from "./care";
import {
  assertPeople,
  currentAdults,
  currentChildIds,
  dateString,
  minor,
  queueNotification,
  release,
  requiredText,
  reserve,
  resolveSpan,
  shortText,
  spanSchema,
  supersedeDeliveries,
} from "./helpers";

/**
 * Me, Us and Family moments (spec 8.2, 8.5, 8.7). A suggestion is not a
 * booking: proposal, agreement, readiness and completion stay distinct.
 */

type MomentRow = typeof moments.$inferSelect;

export const momentFields = z.object({
  kind: z.enum(["me", "us", "family"]),
  title: requiredText(120, "A title"),
  notes: shortText(2000).default(""),
  location: shortText(200).default(""),
  activityKey: z.string().max(80).nullable().default(null),
  span: spanSchema,
  participantIds: z.array(z.uuid()).min(1).max(2),
  childIds: z.array(z.uuid()).max(8).default([]),
  needsCare: z.boolean().default(false),
  budgetMinor: minor.nullable().default(null),
  travelBeforeMinutes: z.number().int().min(0).max(600).default(0),
  travelAfterMinutes: z.number().int().min(0).max(600).default(0),
  surprise: z.boolean().default(false),
  /** Family plans: the child whose pick this was. */
  chosenByChildId: z.uuid().nullable().default(null),
});

async function loadMoment(ctx: CommandContext, id: string): Promise<MomentRow> {
  const [m] = await ctx.tx.select().from(moments).where(and(eq(moments.id, id), eq(moments.householdId, ctx.household.id)));
  // A private draft is invisible to everyone but its organiser (INV-11).
  if (!m || (m.sharing === "private" && m.organiserId !== ctx.actor.accountId)) {
    throw new DomainError("NOT_FOUND", "That plan could not be found.");
  }
  return m;
}

function toFields(m: MomentRow): MomentFields {
  return {
    title: m.title,
    notes: m.notes,
    start: m.startAt.getTime(),
    end: m.endAt.getTime(),
    travelBeforeMinutes: m.travelBeforeMinutes,
    travelAfterMinutes: m.travelAfterMinutes,
    participantIds: m.participantIds,
    childIds: m.childIds,
    needsCare: m.needsCare,
    budgetMinor: m.budgetMinor,
    location: m.location,
  };
}

function occupiedSpan(m: Pick<MomentRow, "startAt" | "endAt" | "travelBeforeMinutes" | "travelAfterMinutes">) {
  return {
    start: m.startAt.getTime() - m.travelBeforeMinutes * 60_000,
    end: m.endAt.getTime() + m.travelAfterMinutes * 60_000,
  };
}

async function acceptanceRecords(ctx: CommandContext, momentId: string): Promise<AcceptanceRecord[]> {
  const rows = await ctx.tx.select().from(acceptances).where(eq(acceptances.momentId, momentId)).orderBy(acceptances.createdAt);
  return rows.map((r) => ({ actorId: r.actorId, materialVersion: r.materialVersion, decision: r.decision }));
}

/** Recheck conflicts inside the accepting transaction: a preview is not a lock (spec 11.3). */
async function assertFree(ctx: CommandContext, m: MomentRow): Promise<void> {
  const span = occupiedSpan(m);
  const busy = await loadBusy(ctx.tx, ctx.household.id, { start: span.start - 86_400_000, end: span.end + 86_400_000 });
  const conflicts = findConflicts(
    { personIds: m.participantIds, start: span.start, end: span.end, excludeSourceIds: [m.id] },
    busy,
    ctx.actor.accountId,
  );
  if (conflicts.length) {
    throw new DomainError("CONFLICT", "This time clashes with something already in the diary.", {
      conflicts: conflicts.map((c) => ({ code: c.code, personId: c.personId, start: c.start, end: c.end, title: c.title })),
    });
  }
}

/** If everyone required has agreed to the current version, reserve the time. */
async function settleAgreement(ctx: CommandContext, m: MomentRow): Promise<boolean> {
  const adults = (await currentAdults(ctx.tx, ctx.household.id)).map((a) => a.id);
  const agreed = isAgreed(m.participantIds, adults, m.materialVersion, await acceptanceRecords(ctx, m.id));
  if (!agreed) return false;
  await assertFree(ctx, m);
  const span = occupiedSpan(m);
  await release(ctx.tx, "moment", m.id);
  await reserve(ctx.tx, ctx.household.id, "moment", m.id, m.participantIds, span.start, span.end);
  // A reminder the day before; superseded automatically if anything changes.
  const remindAt = new Date(m.startAt.getTime() - 24 * 3_600_000);
  if (remindAt.getTime() > ctx.now.getTime()) {
    const names = m.kind === "us" ? await currentAdults(ctx.tx, ctx.household.id) : [];
    for (const p of m.participantIds) {
      // Discreet on a lock screen: who and when, never what.
      const partner = names.find((a) => a.id !== p && m.participantIds.includes(a.id))?.displayName;
      await queueNotification(ctx, {
        recipientId: p,
        kind: "moment.reminder",
        text: m.kind === "me" ? "Your protected time is tomorrow." : m.kind === "us" ? `${plansWith(partner)} ${whenPhrase(m.startAt.getTime(), remindAt.getTime(), ctx.household.timeZone)}.` : "You have a family plan tomorrow.",
        sourceType: "moment",
        sourceId: m.id,
        sourceVersion: m.materialVersion,
        availableAt: remindAt,
      });
    }
  }
  return true;
}

export const createMoment = defineCommand({
  name: "CreateMoment",
  scope: "household",
  payload: momentFields,
  async handler(ctx, p) {
    const participants = p.kind === "me" ? [ctx.actor.accountId] : p.participantIds;
    if (!participants.includes(ctx.actor.accountId) && p.kind !== "family") {
      throw new DomainError("VALIDATION", "Include yourself in this plan.");
    }
    if (p.kind === "us" && participants.length !== 2) throw new DomainError("VALIDATION", "A plan for the two of you needs both adults.");
    await assertPeople(ctx, participants, p.childIds);
    if (p.chosenByChildId) await assertPeople(ctx, [], [p.chosenByChildId]);
    const span = resolveSpan(p.span, ctx.household.timeZone);
    const [m] = await ctx.tx
      .insert(moments)
      .values({
        householdId: ctx.household.id,
        kind: p.kind,
        organiserId: ctx.actor.accountId,
        title: p.title,
        notes: p.notes,
        location: p.location,
        activityKey: p.activityKey,
        startAt: new Date(span.start),
        endAt: new Date(span.end),
        travelBeforeMinutes: p.travelBeforeMinutes,
        travelAfterMinutes: p.travelAfterMinutes,
        participantIds: participants,
        childIds: p.childIds,
        needsCare: p.needsCare,
        budgetMinor: p.budgetMinor,
        surprise: p.surprise,
        chosenByChildId: p.kind === "family" ? p.chosenByChildId : null,
      })
      .returning();
    // A child's pick from their own screen is answered by planning it.
    if (m.chosenByChildId) {
      await ctx.tx.update(childWishes).set({ handledAt: ctx.now }).where(and(eq(childWishes.childId, m.chosenByChildId), isNull(childWishes.handledAt)));
    }
    await ctx.audit("moment.create", "moment", m.id);
    const [{ n }] = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(moments).where(eq(moments.householdId, ctx.household.id));
    if (n === 1) await ctx.track("first_plan_created", p.kind);
    return { momentId: m.id, version: m.version };
  },
});

export const editMoment = defineCommand({
  name: "EditMoment",
  scope: "household",
  payload: z.object({ momentId: z.uuid(), version: z.number().int(), fields: momentFields.omit({ kind: true }) }),
  async handler(ctx, p) {
    const m = await loadMoment(ctx, p.momentId);
    assertVersion(m, p.version, "This plan");
    if (m.lifecycle === "completed" || m.lifecycle === "cancelled") throw new DomainError("CONFLICT", "Finished plans cannot be changed.");
    if (!m.participantIds.includes(ctx.actor.accountId) && m.organiserId !== ctx.actor.accountId) {
      throw new DomainError("NOT_FOUND", "That plan could not be found.");
    }
    const participants = m.kind === "me" ? m.participantIds : p.fields.participantIds;
    await assertPeople(ctx, participants, p.fields.childIds);
    if (p.fields.chosenByChildId) await assertPeople(ctx, [], [p.fields.chosenByChildId]);
    const span = resolveSpan(p.fields.span, ctx.household.timeZone);
    const next: MomentFields = {
      ...toFields(m),
      title: p.fields.title,
      notes: p.fields.notes,
      location: p.fields.location,
      start: span.start,
      end: span.end,
      travelBeforeMinutes: p.fields.travelBeforeMinutes,
      travelAfterMinutes: p.fields.travelAfterMinutes,
      participantIds: participants,
      childIds: p.fields.childIds,
      needsCare: p.fields.needsCare,
      budgetMinor: p.fields.budgetMinor,
    };
    const material = materialChanges(toFields(m), next);
    const [updated] = await ctx.tx
      .update(moments)
      .set({
        title: next.title,
        notes: next.notes,
        location: next.location,
        activityKey: p.fields.activityKey,
        startAt: new Date(next.start),
        endAt: new Date(next.end),
        travelBeforeMinutes: next.travelBeforeMinutes,
        travelAfterMinutes: next.travelAfterMinutes,
        participantIds: [...next.participantIds],
        childIds: [...next.childIds],
        needsCare: next.needsCare,
        budgetMinor: next.budgetMinor,
        surprise: p.fields.surprise,
        chosenByChildId: m.kind === "family" ? p.fields.chosenByChildId : null,
        version: sql`${moments.version} + 1`,
        ...(material.length ? { materialVersion: sql`${moments.materialVersion} + 1`, review: "current" as const, reviewReason: null } : {}),
      })
      .where(eq(moments.id, m.id))
      .returning();

    if (material.length) {
      // A material change releases the old reservation, reopens agreement and
      // task confirmations, and stops stale reminders (spec 8.5).
      await release(ctx.tx, "moment", m.id);
      await supersedeDeliveries(ctx.tx, m.id);
      await ctx.tx
        .update(preparationTasks)
        .set({ state: "open", doneAt: null, version: sql`${preparationTasks.version} + 1` })
        .where(eq(preparationTasks.momentId, m.id));
      await ctx.tx
        .update(expenses)
        .set({ activityDate: instantToLocalDate(next.start, ctx.household.timeZone) })
        .where(and(eq(expenses.sourceType, "moment"), eq(expenses.sourceId, m.id)));
      if (updated.sharing === "shared" && updated.lifecycle === "planned") {
        // The editor's own edit counts as their agreement to the new version.
        await ctx.tx.insert(acceptances).values({
          momentId: m.id,
          actorId: ctx.actor.accountId,
          materialVersion: updated.materialVersion,
          membershipRevision: ctx.household.membershipRevision,
          decision: "accepted",
        });
        for (const other of updated.participantIds.filter((id) => id !== ctx.actor.accountId)) {
          await queueNotification(ctx, {
            recipientId: other,
            kind: "moment.changed",
            text: "A plan changed and needs your answer.",
            sourceType: "moment",
            sourceId: m.id,
            sourceVersion: updated.materialVersion,
          });
        }
        if (updated.kind === "me") await settleAgreement(ctx, updated);
      }
      await ctx.bumpSchedule();
    }
    return { momentId: m.id, version: updated.version, materialVersion: updated.materialVersion, materialChanges: material };
  },
});

/**
 * Swap what a plan is, keeping its time, people and care: the wet-weather
 * swap. Not a material change, so nobody has to agree again; the others are
 * told what it changed to.
 */
export const swapActivity = defineCommand({
  name: "SwapActivity",
  scope: "household",
  payload: z.object({
    momentId: z.uuid(),
    version: z.number().int(),
    title: requiredText(120, "A title"),
    activityKey: z.string().max(80).nullable(),
    location: shortText(200).default(""),
    reason: z.enum(["weather"]).default("weather"),
  }),
  async handler(ctx, p) {
    const m = await loadMoment(ctx, p.momentId);
    assertVersion(m, p.version, "This plan");
    if (m.kind === "us") throw new DomainError("VALIDATION", "Plans for the two of you are changed by whoever made them.");
    if (m.lifecycle !== "planned" && m.lifecycle !== "draft") throw new DomainError("CONFLICT", "Finished plans cannot be changed.");
    if (!m.participantIds.includes(ctx.actor.accountId)) throw new DomainError("NOT_FOUND", "That plan could not be found.");
    const [updated] = await ctx.tx
      .update(moments)
      .set({ title: p.title, activityKey: p.activityKey, location: p.location, version: sql`${moments.version} + 1` })
      .where(eq(moments.id, m.id))
      .returning();
    if (updated.sharing === "shared" && updated.kind === "family") {
      for (const other of updated.participantIds.filter((id) => id !== ctx.actor.accountId)) {
        await queueNotification(ctx, {
          recipientId: other,
          kind: "moment.swapped",
          text: `${ctx.actor.displayName} swapped ${m.title} for ${p.title}, as rain is likely.`,
          sourceType: "moment",
          sourceId: m.id,
          sourceVersion: updated.materialVersion,
        });
      }
    }
    await ctx.bumpSchedule();
    await ctx.audit("moment.swap", "moment", m.id);
    await ctx.track("weather_swap", m.kind);
    return { momentId: m.id, version: updated.version };
  },
});

export const shareMoment = defineCommand({
  name: "ShareMoment",
  scope: "household",
  payload: z.object({ momentId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const m = await loadMoment(ctx, p.momentId);
    assertVersion(m, p.version, "This plan");
    if (m.organiserId !== ctx.actor.accountId) throw new DomainError("NOT_FOUND", "That plan could not be found.");
    if (m.lifecycle !== "draft") throw new DomainError("CONFLICT", "This plan has already been shared.");
    const [updated] = await ctx.tx
      .update(moments)
      .set({ sharing: "shared", lifecycle: "planned", version: sql`${moments.version} + 1` })
      .where(eq(moments.id, m.id))
      .returning();
    await ctx.tx.insert(acceptances).values({
      momentId: m.id,
      actorId: ctx.actor.accountId,
      materialVersion: updated.materialVersion,
      membershipRevision: ctx.household.membershipRevision,
      decision: "accepted",
    });
    const reserved = await settleAgreement(ctx, updated);
    for (const other of updated.participantIds.filter((id) => id !== ctx.actor.accountId)) {
      await queueNotification(ctx, {
        recipientId: other,
        kind: "moment.invited",
        // Time for the two of you never names the plan on a lock screen;
        // surprises keep their details hidden in the app too.
        text: updated.kind === "us" ? `${ctx.actor.displayName} has planned something for ${whenPhrase(updated.startAt.getTime(), ctx.now.getTime(), ctx.household.timeZone)}.` : `${ctx.actor.displayName} invited you to a plan.`,
        sourceType: "moment",
        sourceId: m.id,
        sourceVersion: updated.materialVersion,
      });
    }
    await ctx.bumpSchedule();
    await ctx.audit("moment.share", "moment", m.id);
    await ctx.track("moment_shared", m.kind);
    return { momentId: m.id, reserved };
  },
});

export const respondToMoment = defineCommand({
  name: "RespondToMoment",
  scope: "household",
  payload: z.object({
    momentId: z.uuid(),
    materialVersion: z.number().int(),
    decision: z.enum(["accepted", "alternative", "declined"]),
  }),
  async handler(ctx, p) {
    const m = await loadMoment(ctx, p.momentId);
    if (m.lifecycle !== "planned" || m.sharing !== "shared") throw new DomainError("CONFLICT", "This plan is not waiting for an answer.");
    if (!m.participantIds.includes(ctx.actor.accountId)) {
      throw new DomainError("NOT_FOUND", "That plan could not be found.");
    }
    // Agreement is to a specific version: answering an old one is refused (INV-03).
    if (p.materialVersion !== m.materialVersion) {
      throw new DomainError("STALE_VERSION", "This plan changed since you looked. Check the new details before answering.", {
        materialVersion: m.materialVersion,
      });
    }
    await ctx.tx.insert(acceptances).values({
      momentId: m.id,
      actorId: ctx.actor.accountId,
      materialVersion: m.materialVersion,
      membershipRevision: ctx.household.membershipRevision,
      decision: p.decision,
    });
    let reserved = false;
    if (p.decision === "accepted") {
      reserved = await settleAgreement(ctx, m);
    } else {
      // Changing a yes to a no undoes the agreement: free the time and stop
      // the day-before reminders that the earlier yes queued.
      await release(ctx.tx, "moment", m.id);
      await supersedeDeliveries(ctx.tx, m.id, "moment.reminder");
    }
    await ctx.tx.update(moments).set({ version: sql`${moments.version} + 1` }).where(eq(moments.id, m.id));
    for (const other of m.participantIds.filter((id) => id !== ctx.actor.accountId)) await queueNotification(ctx, {
      recipientId: other,
      kind: `moment.${p.decision}`,
      text:
        p.decision === "accepted"
          ? `${ctx.actor.displayName} said yes to your plan.`
          : p.decision === "alternative"
            ? `${ctx.actor.displayName} would like another time.`
            : `${ctx.actor.displayName} can't make your plan.`,
      sourceType: "moment",
      sourceId: m.id,
      sourceVersion: m.materialVersion,
    });
    await ctx.bumpSchedule();
    await ctx.audit(`moment.${p.decision}`, "moment", m.id);
    if (reserved) await ctx.track("moment_agreed", m.kind);
    return { momentId: m.id, reserved };
  },
});

export const cancelMoment = defineCommand({
  name: "CancelMoment",
  scope: "household",
  payload: z.object({ momentId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const m = await loadMoment(ctx, p.momentId);
    assertVersion(m, p.version, "This plan");
    if (!m.participantIds.includes(ctx.actor.accountId) && m.organiserId !== ctx.actor.accountId) {
      throw new DomainError("NOT_FOUND", "That plan could not be found.");
    }
    if (m.lifecycle === "completed" || m.lifecycle === "cancelled") throw new DomainError("CONFLICT", "This plan is already finished.");
    // Cancelling releases time and stops reminders; money history stays (spec 8.5).
    await ctx.tx.update(moments).set({ lifecycle: "cancelled", version: sql`${moments.version} + 1` }).where(eq(moments.id, m.id));
    await release(ctx.tx, "moment", m.id);
    await supersedeDeliveries(ctx.tx, m.id);
    if (m.sharing === "shared") {
      for (const other of m.participantIds.filter((id) => id !== ctx.actor.accountId)) {
        await queueNotification(ctx, {
          recipientId: other,
          kind: "moment.cancelled",
          text: "A plan was cancelled.",
          sourceType: "moment",
          sourceId: m.id,
          sourceVersion: m.materialVersion + 1000,
        });
      }
    }
    await ctx.bumpSchedule();
    await ctx.audit("moment.cancel", "moment", m.id);
    return { momentId: m.id };
  },
});

export const deleteDraft = defineCommand({
  name: "DeleteDraft",
  scope: "household",
  payload: z.object({ momentId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const m = await loadMoment(ctx, p.momentId);
    assertVersion(m, p.version, "This plan");
    if (m.lifecycle !== "draft" || m.organiserId !== ctx.actor.accountId) throw new DomainError("CONFLICT", "Only an unshared draft can be deleted.");
    await ctx.tx.delete(preparationTasks).where(eq(preparationTasks.momentId, m.id));
    await ctx.tx.delete(moments).where(eq(moments.id, m.id));
    return { deleted: true };
  },
});

export const completeMoment = defineCommand({
  name: "CompleteMoment",
  scope: "household",
  payload: z.object({ momentId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const m = await loadMoment(ctx, p.momentId);
    assertVersion(m, p.version, "This plan");
    if (m.lifecycle !== "planned") throw new DomainError("CONFLICT", "Only a planned moment can be completed.");
    if (m.startAt.getTime() > ctx.now.getTime()) throw new DomainError("CONFLICT", "This plan hasn't started yet.");
    if (!m.participantIds.includes(ctx.actor.accountId)) throw new DomainError("NOT_FOUND", "That plan could not be found.");
    await ctx.tx.update(moments).set({ lifecycle: "completed", version: sql`${moments.version} + 1` }).where(eq(moments.id, m.id));
    await supersedeDeliveries(ctx.tx, m.id);
    await ctx.audit("moment.complete", "moment", m.id);
    await ctx.track("moment_completed", m.kind);
    return { momentId: m.id };
  },
});

// ── Preparation tasks ──────────────────────────────────────────────────────

export const addTask = defineCommand({
  name: "AddTask",
  scope: "household",
  payload: z.object({ momentId: z.uuid(), title: requiredText(120, "A task"), ownerId: z.uuid() }),
  async handler(ctx, p) {
    const m = await loadMoment(ctx, p.momentId);
    await assertPeople(ctx, [p.ownerId], []);
    const [t] = await ctx.tx
      .insert(preparationTasks)
      .values({ householdId: ctx.household.id, momentId: m.id, title: p.title, ownerId: p.ownerId })
      .returning();
    if (p.ownerId !== ctx.actor.accountId && m.sharing === "shared") {
      await queueNotification(ctx, {
        recipientId: p.ownerId,
        kind: "task.assigned",
        text: `${ctx.actor.displayName} asked you to help with a plan.`,
        sourceType: "task",
        sourceId: t.id,
        sourceVersion: t.version,
      });
    }
    return { taskId: t.id };
  },
});

export const setTaskDone = defineCommand({
  name: "SetTaskDone",
  scope: "household",
  payload: z.object({ taskId: z.uuid(), version: z.number().int(), done: z.boolean() }),
  async handler(ctx, p) {
    const [t] = await ctx.tx
      .select()
      .from(preparationTasks)
      .where(and(eq(preparationTasks.id, p.taskId), eq(preparationTasks.householdId, ctx.household.id)));
    assertVersion(t, p.version, "This task");
    // Owners confirm their own tasks (AT-07).
    if (t.ownerId !== ctx.actor.accountId) throw new DomainError("FORBIDDEN", "Only the person this task belongs to can tick it off.");
    await ctx.tx
      .update(preparationTasks)
      .set({ state: p.done ? "done" : "open", doneAt: p.done ? ctx.now : null, version: sql`${preparationTasks.version} + 1` })
      .where(eq(preparationTasks.id, t.id));
    return { taskId: t.id };
  },
});

export const reassignTask = defineCommand({
  name: "ReassignTask",
  scope: "household",
  payload: z.object({ taskId: z.uuid(), version: z.number().int(), ownerId: z.uuid() }),
  async handler(ctx, p) {
    const [t] = await ctx.tx
      .select()
      .from(preparationTasks)
      .where(and(eq(preparationTasks.id, p.taskId), eq(preparationTasks.householdId, ctx.household.id)));
    assertVersion(t, p.version, "This task");
    await assertPeople(ctx, [p.ownerId], []);
    // Reassignment reopens the task for its new owner to confirm.
    await ctx.tx
      .update(preparationTasks)
      .set({ ownerId: p.ownerId, state: "open", doneAt: null, version: sql`${preparationTasks.version} + 1` })
      .where(eq(preparationTasks.id, t.id));
    return { taskId: t.id };
  },
});

// ── Private reflection ─────────────────────────────────────────────────────

export const saveFeedback = defineCommand({
  name: "SaveFeedback",
  scope: "household",
  payload: z.object({
    momentId: z.uuid(),
    helpful: z.boolean().nullable().default(null),
    enjoyed: z.boolean().nullable().default(null),
    wantRepeat: z.boolean().nullable().default(null),
    effortOk: z.boolean().nullable().default(null),
    note: shortText(2000).default(""),
  }),
  async handler(ctx, p) {
    const m = await loadMoment(ctx, p.momentId);
    if (m.lifecycle !== "completed") throw new DomainError("CONFLICT", "You can reflect once the plan is complete.");
    if (!m.participantIds.includes(ctx.actor.accountId)) throw new DomainError("NOT_FOUND", "That plan could not be found.");
    // Reflection is owned by the account and never shown to the partner.
    const { momentId, ...answers } = p;
    await ctx.tx
      .insert(feedback)
      .values({ accountId: ctx.actor.accountId, momentId, activityKey: m.activityKey ?? `custom:${m.kind}`, ...answers })
      .onConflictDoUpdate({ target: [feedback.accountId, feedback.momentId], set: answers });
    return { saved: true };
  },
});

// ── Shared highlights ──────────────────────────────────────────────────────

/**
 * One line about a plan that happened, for everyone in it (spec 8.10).
 * Separate from private reflection; saving an empty line removes it.
 */
export const saveHighlight = defineCommand({
  name: "SaveHighlight",
  scope: "household",
  payload: z.object({ momentId: z.uuid(), text: shortText(280) }),
  async handler(ctx, p) {
    const m = await loadMoment(ctx, p.momentId);
    if (m.lifecycle !== "completed") throw new DomainError("CONFLICT", "You can add a highlight once the plan has happened.");
    if (!m.participantIds.includes(ctx.actor.accountId) && m.kind !== "family") throw new DomainError("NOT_FOUND", "That plan could not be found.");
    if (!p.text) {
      await ctx.tx.delete(highlights).where(and(eq(highlights.momentId, m.id), eq(highlights.accountId, ctx.actor.accountId)));
      return { removed: true };
    }
    const [h] = await ctx.tx
      .insert(highlights)
      .values({ householdId: ctx.household.id, momentId: m.id, accountId: ctx.actor.accountId, text: p.text })
      .onConflictDoUpdate({ target: [highlights.momentId, highlights.accountId], set: { text: p.text, updatedAt: ctx.now } })
      .returning();
    const others = (m.kind === "family" ? (await currentAdults(ctx.tx, ctx.household.id)).map((a) => a.id) : m.participantIds).filter((id) => id !== ctx.actor.accountId);
    for (const other of others) {
      await queueNotification(ctx, {
        recipientId: other,
        kind: "highlight.added",
        text: `${ctx.actor.displayName} added a memory to a plan you shared.`,
        sourceType: "moment",
        sourceId: m.id,
        sourceVersion: h.updatedAt.getTime(),
      });
    }
    await ctx.track("highlight_shared", m.kind);
    return { saved: true };
  },
});

// ── The Sunday ten minutes ─────────────────────────────────────────────────

/**
 * Send a week's worth of plans to the other adult in one go: each becomes an
 * ordinary shared plan waiting for their answer (spec 3.3, 8.5).
 */
export const planWeek = defineCommand({
  name: "PlanWeek",
  scope: "household",
  payload: z.object({
    weekKey: dateString.refine(isWeekKey, "A week starts on a Monday."),
    items: z.array(momentFields.extend({ askPartnerToCover: z.boolean().default(false) })).max(8),
  }),
  async handler(ctx, p) {
    const created: string[] = [];
    for (const { askPartnerToCover, ...item } of p.items) {
      const c = await createMoment.handler(ctx, item);
      await shareMoment.handler(ctx, { momentId: c.momentId, version: c.version });
      created.push(c.momentId);
      // Me time where the other adult is free: ask them to have the children.
      if (askPartnerToCover && item.kind === "me") {
        const partner = (await currentAdults(ctx.tx, ctx.household.id)).find((a) => a.id !== ctx.actor.accountId);
        const kids = await currentChildIds(ctx.tx, ctx.household.id);
        if (partner && kids.length) {
          await arrangeCare.handler(ctx, { kind: "parent", responsibleAccountId: partner.id, providerName: null, childIds: kids, span: item.span, note: "", confirmed: false });
        }
      }
    }
    await ctx.tx
      .insert(weekPlans)
      .values({ householdId: ctx.household.id, weekKey: p.weekKey, accountId: ctx.actor.accountId, items: created.length })
      .onConflictDoUpdate({ target: [weekPlans.householdId, weekPlans.weekKey, weekPlans.accountId], set: { items: sql`${weekPlans.items} + ${created.length}` } });
    await ctx.track("week_planned", String(created.length));
    return { momentIds: created };
  },
});
