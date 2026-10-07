import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { jobDone, jobs } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { currentAdults, dateString, queueNotification, requiredText, shortText, supersedeDeliveries } from "./helpers";

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
});

async function loadJob(ctx: CommandContext, id: string) {
  const [j] = await ctx.tx.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.householdId, ctx.household.id), isNull(jobs.archivedAt)));
  if (!j) throw new DomainError("NOT_FOUND", "That job could not be found.");
  return j;
}

async function partnerOf(ctx: CommandContext) {
  return (await currentAdults(ctx.tx, ctx.household.id)).find((a) => a.id !== ctx.actor.accountId) ?? null;
}

export const addJob = defineCommand({
  name: "AddJob",
  scope: "household",
  payload: jobFields.extend({ owner: z.enum(["me", "partner", "none"]).default("me") }),
  async handler(ctx, p) {
    const count = await ctx.tx.$count(jobs, and(eq(jobs.householdId, ctx.household.id), isNull(jobs.archivedAt)));
    if (count >= 60) throw new DomainError("VALIDATION", "Up to sixty jobs can be tracked. Archive a few you no longer need.");
    const partner = p.owner === "partner" ? await partnerOf(ctx) : null;
    if (p.owner === "partner" && !partner) throw new DomainError("VALIDATION", "Invite your partner before asking them to take a job on.");
    const { owner, ...fields } = p;
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
  payload: jobFields.extend({ jobId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const j = await loadJob(ctx, p.jobId);
    assertVersion(j, p.version, "This job");
    const { jobId, version, ...fields } = p;
    void version;
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
