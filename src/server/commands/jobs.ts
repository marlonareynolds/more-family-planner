import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { jobDone, jobStepDone, jobSteps, jobs } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { ACTIVE_JOB_LIMIT, isActiveJob } from "@/domain/jobs";
import { instantToLocalDate } from "@/domain/time";
import { linkedTitles } from "../linked";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { currentAdults, dateString, queueNotification, requiredText, shortText, supersedeDeliveries, timeString } from "./helpers";

/**
 * The shared load: recurring household jobs with one agreed owner each.
 * Taking a job on yourself needs nobody's say-so; giving one to your
 * partner is a request they answer, never an assignment.
 */

const jobFields = z.object({
  title: requiredText(80, "A name"),
  notes: shortText(500).default(""),
  cadence: z.enum(["once", "weekly", "fortnightly", "monthly", "yearly"]),
  startsOn: dateString,
  remindDayBefore: z.boolean().default(false),
  minutes: z.number().int().min(1).max(600).default(15),
  /** A precise cut-off for a one-off ("by 12 noon"); left out, it stays as it was. */
  dueTime: timeString.nullable().optional(),
});

async function loadJob(ctx: CommandContext, id: string) {
  const [j] = await ctx.tx.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.householdId, ctx.household.id), isNull(jobs.archivedAt)));
  if (!j) throw new DomainError("NOT_FOUND", "That job could not be found.");
  return j;
}

export async function partnerOf(ctx: CommandContext) {
  return (await currentAdults(ctx.tx, ctx.household.id)).find((a) => a.id !== ctx.actor.accountId) ?? null;
}

/** A checklist: up to twelve short steps, blanks dropped. */
const stepList = z.array(shortText(80)).max(12).default([]).transform((s) => s.filter(Boolean));

/**
 * Refuse a new job when the household already tracks sixty live ones. Done
 * one-offs and past dinners don't count (see `isActiveJob`), so the limit
 * is about what's live, not about history.
 */
export async function assertRoomForJob(ctx: CommandContext): Promise<void> {
  const rows = await ctx.tx.select({ id: jobs.id, cadence: jobs.cadence, startsOn: jobs.startsOn, forType: jobs.forType, archivedAt: jobs.archivedAt }).from(jobs).where(and(eq(jobs.householdId, ctx.household.id), isNull(jobs.archivedAt)));
  if (rows.length < ACTIVE_JOB_LIMIT) return;
  const today = instantToLocalDate(ctx.now.getTime(), ctx.household.timeZone);
  const once = rows.filter((r) => r.cadence === "once");
  const done = once.length ? await ctx.tx.select({ jobId: jobDone.jobId, dueOn: jobDone.dueOn }).from(jobDone).where(inArray(jobDone.jobId, once.map((r) => r.id))) : [];
  const doneKeys = new Set(done.map((d) => `${d.jobId}:${d.dueOn}`));
  const active = rows.filter((r) => isActiveJob(r, today, new Set(doneKeys.has(`${r.id}:${r.startsOn}`) ? [r.startsOn] : []))).length;
  if (active >= ACTIVE_JOB_LIMIT) throw new DomainError("VALIDATION", "Up to sixty jobs can be tracked. Archive a few you no longer need.");
}

export async function writeSteps(ctx: CommandContext, jobId: string, steps: readonly string[]): Promise<void> {
  // Keep a step that is unchanged, so its ticks stay; drop the rest.
  const old = await ctx.tx.select().from(jobSteps).where(eq(jobSteps.jobId, jobId));
  const keep = new Map(old.map((s) => [s.text, s]));
  const gone = old.filter((s) => !steps.includes(s.text));
  if (gone.length) await ctx.tx.delete(jobSteps).where(inArray(jobSteps.id, gone.map((s) => s.id)));
  for (const [position, text] of steps.entries()) {
    const was = keep.get(text);
    if (was) await ctx.tx.update(jobSteps).set({ position }).where(eq(jobSteps.id, was.id));
    else await ctx.tx.insert(jobSteps).values({ householdId: ctx.household.id, jobId, position, text });
  }
}

export const addJob = defineCommand({
  name: "AddJob",
  scope: "household",
  payload: jobFields.extend({
    owner: z.enum(["me", "partner", "none"]).default("me"),
    /** The diary item this is for: a trip's payment, its consent form. */
    forType: z.enum(["event", "trip"]).nullable().default(null),
    forId: z.uuid().nullable().default(null),
    /** An optional checklist, from a template or typed. */
    steps: stepList,
  }),
  async handler(ctx, p) {
    if (p.dueTime && p.cadence !== "once") throw new DomainError("VALIDATION", "A cut-off time is for a one-off job.");
    if ((p.forType === null) !== (p.forId === null)) throw new DomainError("VALIDATION", "Say which diary item this is for.");
    // Only an item in this household that this adult can see; never another household's.
    if (p.forType && p.forId && !(await linkedTitles(ctx.tx, ctx.household.id, ctx.actor.accountId, [{ type: p.forType, id: p.forId }])).has(p.forId)) {
      throw new DomainError("NOT_FOUND", "That diary item could not be found.");
    }
    await assertRoomForJob(ctx);
    const partner = p.owner === "partner" ? await partnerOf(ctx) : null;
    if (p.owner === "partner" && !partner) throw new DomainError("VALIDATION", "Invite your partner before asking them to take a job on.");
    const { owner, steps, ...fields } = p;
    const [j] = await ctx.tx
      .insert(jobs)
      .values({
        ...fields,
        householdId: ctx.household.id,
        createdBy: ctx.actor.accountId,
        ownerId: owner === "me" ? ctx.actor.accountId : null,
        proposedOwnerId: partner?.id ?? null,
        proposedBy: partner ? ctx.actor.accountId : null,
      })
      .returning();
    if (steps.length) await writeSteps(ctx, j.id, steps);
    if (partner) {
      await queueNotification(ctx, { recipientId: partner.id, kind: "job.proposed", text: `${ctx.actor.displayName} asked if you could take on “${j.title}”.`, sourceType: "job", sourceId: j.id, sourceVersion: j.version });
    }
    await ctx.audit("job.add", "job", j.id);
    await ctx.track("job_added", owner);
    return { jobId: j.id };
  },
});

export const editJob = defineCommand({
  name: "EditJob",
  scope: "household",
  payload: jobFields.extend({ jobId: z.uuid(), version: z.number().int(), steps: z.array(shortText(80)).max(12).transform((s) => s.filter(Boolean)).optional() }),
  async handler(ctx, p) {
    const j = await loadJob(ctx, p.jobId);
    assertVersion(j, p.version, "This job");
    const { jobId, version, steps, ...fields } = p;
    void version;
    // A dinner's job follows its dinner: move the dinner, and the job moves with it.
    if (j.forType === "dinner" && (fields.cadence !== j.cadence || fields.startsOn !== j.startsOn)) {
      throw new DomainError("VALIDATION", "This is part of a dinner. Change the day on Our Week, and the job moves with it.");
    }
    if (steps) await writeSteps(ctx, j.id, steps);
    await ctx.tx.update(jobs).set({ ...fields, version: sql`${jobs.version} + 1` }).where(eq(jobs.id, jobId));
    // New dates mean new reminders; the old ones must not fire.
    if (fields.cadence !== j.cadence || fields.startsOn !== j.startsOn || fields.remindDayBefore !== j.remindDayBefore) await supersedeDeliveries(ctx.tx, j.id, "job.due");
    return { jobId };
  },
});

/** Take a job on, ask your partner to, or put it back in the shared pot. */
export const proposeJobOwner = defineCommand({
  name: "ProposeJobOwner",
  scope: "household",
  payload: z.object({ jobId: z.uuid(), version: z.number().int(), to: z.enum(["me", "partner", "none"]) }),
  async handler(ctx, p) {
    const j = await loadJob(ctx, p.jobId);
    assertVersion(j, p.version, "This job");
    const me = ctx.actor.accountId;
    const partner = await partnerOf(ctx);
    const bump = { version: sql`${jobs.version} + 1` };
    if (p.to === "me") {
      await ctx.tx.update(jobs).set({ ownerId: me, proposedOwnerId: null, proposedBy: null, ...bump }).where(eq(jobs.id, j.id));
      if (j.ownerId && j.ownerId !== me) {
        await queueNotification(ctx, { recipientId: j.ownerId, kind: "job.taken", text: `${ctx.actor.displayName} took over “${j.title}”.`, sourceType: "job", sourceId: j.id, sourceVersion: j.version + 1 });
      }
    } else if (p.to === "none") {
      if (j.ownerId && j.ownerId !== me) throw new DomainError("FORBIDDEN", "Only the person who looks after this job can put it back.");
      await ctx.tx.update(jobs).set({ ownerId: null, proposedOwnerId: null, proposedBy: null, ...bump }).where(eq(jobs.id, j.id));
      if (j.ownerId === me && partner) {
        await queueNotification(ctx, { recipientId: partner.id, kind: "job.released", text: `${ctx.actor.displayName} put “${j.title}” back in the shared list.`, sourceType: "job", sourceId: j.id, sourceVersion: j.version + 1 });
      }
    } else {
      if (!partner) throw new DomainError("VALIDATION", "Invite your partner before asking them to take a job on.");
      if (j.ownerId === partner.id) throw new DomainError("VALIDATION", `${partner.displayName} already looks after this.`);
      await ctx.tx.update(jobs).set({ proposedOwnerId: partner.id, proposedBy: me, ...bump }).where(eq(jobs.id, j.id));
      await queueNotification(ctx, { recipientId: partner.id, kind: "job.proposed", text: `${ctx.actor.displayName} asked if you could take on “${j.title}”.`, sourceType: "job", sourceId: j.id, sourceVersion: j.version + 1 });
    }
    await supersedeDeliveries(ctx.tx, j.id, "job.due");
    await ctx.audit(`job.owner.${p.to}`, "job", j.id);
    return { jobId: j.id };
  },
});

export const answerJobOwner = defineCommand({
  name: "AnswerJobOwner",
  scope: "household",
  payload: z.object({ jobId: z.uuid(), version: z.number().int(), accept: z.boolean() }),
  async handler(ctx, p) {
    const j = await loadJob(ctx, p.jobId);
    assertVersion(j, p.version, "This job");
    if (j.proposedOwnerId !== ctx.actor.accountId) throw new DomainError("CONFLICT", "There's nothing to answer on this job any more.");
    await ctx.tx
      .update(jobs)
      .set({ ...(p.accept ? { ownerId: ctx.actor.accountId } : {}), proposedOwnerId: null, proposedBy: null, version: sql`${jobs.version} + 1` })
      .where(eq(jobs.id, j.id));
    if (j.proposedBy && j.proposedBy !== ctx.actor.accountId) {
      await queueNotification(ctx, {
        recipientId: j.proposedBy,
        kind: "job.answered",
        text: p.accept ? `${ctx.actor.displayName} is taking on “${j.title}”.` : `${ctx.actor.displayName} can't take on “${j.title}” right now.`,
        sourceType: "job",
        sourceId: j.id,
        sourceVersion: j.version + 1,
      });
    }
    await supersedeDeliveries(ctx.tx, j.id, "job.due");
    await ctx.audit(p.accept ? "job.owner.accept" : "job.owner.decline", "job", j.id);
    if (p.accept) await ctx.track("job_handed_over");
    return { jobId: j.id };
  },
});

export const markJobDone = defineCommand({
  name: "MarkJobDone",
  scope: "household",
  payload: z.object({ jobId: z.uuid(), dueOn: dateString }),
  async handler(ctx, p) {
    const j = await loadJob(ctx, p.jobId);
    const [row] = await ctx.tx
      .insert(jobDone)
      .values({ jobId: j.id, dueOn: p.dueOn, householdId: ctx.household.id, doneBy: ctx.actor.accountId })
      .onConflictDoNothing()
      .returning();
    if (row && j.ownerId && j.ownerId !== ctx.actor.accountId) {
      await queueNotification(ctx, { recipientId: j.ownerId, kind: "job.covered", text: `${ctx.actor.displayName} did “${j.title}” for you.`, sourceType: "job", sourceId: j.id, sourceVersion: Number(p.dueOn.replaceAll("-", "")) });
    }
    await ctx.audit("job.done", "job", j.id);
    return { jobId: j.id };
  },
});

/** Tick or untick one checklist step for one due date. Nobody is notified. */
export const tickJobStep = defineCommand({
  name: "TickJobStep",
  scope: "household",
  payload: z.object({ stepId: z.uuid(), dueOn: dateString, done: z.boolean() }),
  async handler(ctx, p) {
    const [s] = await ctx.tx.select().from(jobSteps).where(and(eq(jobSteps.id, p.stepId), eq(jobSteps.householdId, ctx.household.id)));
    if (!s) throw new DomainError("NOT_FOUND", "That step could not be found.");
    await loadJob(ctx, s.jobId);
    if (p.done) await ctx.tx.insert(jobStepDone).values({ stepId: s.id, dueOn: p.dueOn, householdId: ctx.household.id, doneBy: ctx.actor.accountId }).onConflictDoNothing();
    else await ctx.tx.delete(jobStepDone).where(and(eq(jobStepDone.stepId, s.id), eq(jobStepDone.dueOn, p.dueOn)));
    return { stepId: s.id };
  },
});

export const undoJobDone = defineCommand({
  name: "UndoJobDone",
  scope: "household",
  payload: z.object({ jobId: z.uuid(), dueOn: dateString }),
  async handler(ctx, p) {
    const j = await loadJob(ctx, p.jobId);
    await ctx.tx.delete(jobDone).where(and(eq(jobDone.jobId, j.id), eq(jobDone.dueOn, p.dueOn)));
    return { jobId: j.id };
  },
});

export const archiveJob = defineCommand({
  name: "ArchiveJob",
  scope: "household",
  payload: z.object({ jobId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const j = await loadJob(ctx, p.jobId);
    assertVersion(j, p.version, "This job");
    await ctx.tx.update(jobs).set({ archivedAt: ctx.now, proposedOwnerId: null, proposedBy: null, version: sql`${jobs.version} + 1` }).where(eq(jobs.id, j.id));
    await supersedeDeliveries(ctx.tx, j.id);
    await ctx.audit("job.archive", "job", j.id);
    return { jobId: j.id };
  },
});

/** When an adult leaves, their jobs go back to the shared list. */
export async function releaseJobsOf(ctx: CommandContext, accountId: string): Promise<void> {
  await ctx.tx
    .update(jobs)
    .set({ ownerId: null, version: sql`${jobs.version} + 1` })
    .where(and(eq(jobs.householdId, ctx.household.id), eq(jobs.ownerId, accountId)));
  await ctx.tx
    .update(jobs)
    .set({ proposedOwnerId: null, proposedBy: null, version: sql`${jobs.version} + 1` })
    .where(and(eq(jobs.householdId, ctx.household.id), sql`(${jobs.proposedOwnerId} = ${accountId} or ${jobs.proposedBy} = ${accountId})`));
}
