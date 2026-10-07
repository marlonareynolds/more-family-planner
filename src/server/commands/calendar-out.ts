import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { calendarExports } from "@/db/schema";
import { defineCommand } from "../pipeline";

/**
 * A private link that puts this adult's More plans into their own calendar
 * app. Making a new link replaces the old one, which stops working at once.
 */

export const hashCalendarToken = (t: string) => createHash("sha256").update(t).digest("hex");

export const createCalendarLink = defineCommand({
  name: "CreateCalendarLink",
  scope: "account",
  payload: z.object({}),
  async handler(ctx) {
    const token = randomBytes(24).toString("base64url");
    await ctx.tx
      .insert(calendarExports)
      .values({ accountId: ctx.actor.accountId, tokenHash: hashCalendarToken(token) })
      .onConflictDoUpdate({ target: calendarExports.accountId, set: { tokenHash: hashCalendarToken(token), createdAt: ctx.now, lastFetchedAt: null } });
    await ctx.audit("calendar_out.create", "account", ctx.actor.accountId);
    await ctx.track("calendar_linked");
    return { token };
  },
});

export const removeCalendarLink = defineCommand({
  name: "RemoveCalendarLink",
  scope: "account",
  payload: z.object({}),
  async handler(ctx) {
    await ctx.tx.delete(calendarExports).where(eq(calendarExports.accountId, ctx.actor.accountId));
    await ctx.audit("calendar_out.remove", "account", ctx.actor.accountId);
    return {};
  },
});
