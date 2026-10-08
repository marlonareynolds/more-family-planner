import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, trialResponses } from "@/db/schema";
import { isWeekKey } from "@/domain/time";
import { defineCommand } from "../pipeline";
import { dateString, shortText } from "./helpers";

const count = (max: number) => z.number().int().min(0).max(max).nullable().default(null);

/**
 * The household trial's weekly questions (spec 21.2). Every answer is
 * optional and private to its author unless they choose to share it with
 * the trial; sharing can be withdrawn by saving again.
 */
export const saveTrialResponse = defineCommand({
  name: "SaveTrialResponse",
  scope: "account",
  payload: z.object({
    weekKey: dateString.refine(isWeekKey, "A week starts on a Monday."),
    baseline: z.boolean().default(false),
    meMoments: count(50),
    usMoments: count(50),
    familyMoments: count(50),
    minutesInApp: count(6000),
    minutesOutside: count(6000),
    fairlyAgreed: z.number().int().min(1).max(5).nullable().default(null),
    restoredTime: z.number().int().min(1).max(5).nullable().default(null),
    lessToCarry: z.number().int().min(1).max(5).nullable().default(null),
    continueChoice: z.enum(["yes", "unsure", "no"]).nullable().default(null),
    helped: shortText(1000).default(""),
    friction: shortText(1000).default(""),
    shareWithTrial: z.boolean().default(false),
  }),
  async handler(ctx, p) {
    const { weekKey, ...values } = p;
    const [row] = await ctx.tx
      .insert(trialResponses)
      .values({ accountId: ctx.actor.accountId, weekKey, ...values })
      .onConflictDoUpdate({
        target: [trialResponses.accountId, trialResponses.weekKey],
        set: { ...values, updatedAt: ctx.now, version: sql`${trialResponses.version} + 1` },
      })
      .returning();
    await ctx.track("trial_response_saved", p.baseline ? "baseline" : "weekly");
    return { responseId: row.id };
  },
});

export const setAnalyticsOptOut = defineCommand({
  name: "SetAnalyticsOptOut",
  scope: "account",
  payload: z.object({ optOut: z.boolean() }),
  async handler(ctx, p) {
    await ctx.tx.update(accounts).set({ analyticsOptOut: p.optOut, version: sql`${accounts.version} + 1` }).where(eq(accounts.id, ctx.actor.accountId));
    return { optOut: p.optOut };
  },
});
