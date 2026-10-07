import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  accounts,
  calendarExports,
  checkins,
  emailSends,
  feedback,
  journalEntries,
  memberships,
  notifications,
  preferences,
  pushSubscriptions,
  supportRequests,
  suppressions,
  trialResponses,
} from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { defineCommand } from "../pipeline";

/**
 * Close your own account. Leave the household first (that hands plans,
 * jobs and calendars back to whoever stays). Then everything that was only
 * yours is erased: journal, check-ins, feedback, what More learned about
 * you, trial answers, notifications and devices. Your name becomes "Former
 * member" on shared history. Signing in again with the same email starts a
 * fresh, empty account.
 */
export const closeAccount = defineCommand({
  name: "CloseAccount",
  scope: "account",
  payload: z.object({ confirm: z.literal("close") }),
  async handler(ctx) {
    const me = ctx.actor.accountId;
    const [member] = await ctx.tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.accountId, me), isNull(memberships.endsAt)));
    if (member) throw new DomainError("CONFLICT", "Leave your household first, then close your account.");

    for (const table of [journalEntries, checkins, feedback, preferences, suppressions, trialResponses, notifications, pushSubscriptions, emailSends, calendarExports]) {
      await ctx.tx.delete(table).where(eq(table.accountId, me));
    }
    // Support messages stay for the operator to finish handling, no longer tied to you.
    await ctx.tx.update(supportRequests).set({ accountId: null }).where(eq(supportRequests.accountId, me));
    await ctx.tx
      .update(accounts)
      .set({ closedAt: ctx.now, displayName: "Former member", email: null, identitySubject: `closed:${me}`, pushEnabled: false, weeklyEmail: false, dateHints: false, analyticsOptOut: true })
      .where(eq(accounts.id, me));
    await ctx.audit("account.close", "account", me);
    return { closed: true };
  },
});
