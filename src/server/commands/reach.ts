import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { accounts, notifications, pushSubscriptions } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { defineCommand } from "../pipeline";
import { shortText, timeString } from "./helpers";

/**
 * How More reaches each adult outside the app (spec 13.2). Settings are the
 * adult's own; a partner never sees or changes them.
 */

const MAX_DEVICES = 10;

export const savePushSubscription = defineCommand({
  name: "SavePushSubscription",
  scope: "account",
  payload: z.object({
    endpoint: z.url().max(1000).refine((u) => u.startsWith("https://"), "Push needs a secure address."),
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(8).max(100),
    label: shortText(60).default(""),
  }),
  async handler(ctx, p) {
    const mine = await ctx.tx.$count(pushSubscriptions, eq(pushSubscriptions.accountId, ctx.actor.accountId));
    if (mine >= MAX_DEVICES) throw new DomainError("VALIDATION", "Notifications are on for ten devices already. Turn one off first.");
    // A device that moves to another account belongs to the new one.
    await ctx.tx
      .insert(pushSubscriptions)
      .values({ accountId: ctx.actor.accountId, endpoint: p.endpoint, p256dh: p.p256dh, auth: p.auth, label: p.label })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { accountId: ctx.actor.accountId, p256dh: p.p256dh, auth: p.auth, label: p.label, failures: 0 } });
    await ctx.tx.update(accounts).set({ pushEnabled: true }).where(eq(accounts.id, ctx.actor.accountId));
    await ctx.track("push_enabled");
    return { saved: true };
  },
});

export const removePushSubscription = defineCommand({
  name: "RemovePushSubscription",
  scope: "account",
  payload: z.object({ endpoint: z.string().max(1000) }),
  async handler(ctx, p) {
    await ctx.tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.accountId, ctx.actor.accountId), eq(pushSubscriptions.endpoint, p.endpoint)));
    return { removed: true };
  },
});

export const updateReachSettings = defineCommand({
  name: "UpdateReachSettings",
  scope: "account",
  payload: z.object({
    pushEnabled: z.boolean(),
    weeklyEmail: z.boolean(),
    quietStart: timeString,
    quietEnd: timeString,
    dateHints: z.boolean().optional(),
  }),
  async handler(ctx, p) {
    await ctx.tx.update(accounts).set(p).where(eq(accounts.id, ctx.actor.accountId));
    return { saved: true };
  },
});

/** A test message to this adult's own devices, through the normal path. */
export const sendTestNotification = defineCommand({
  name: "SendTestNotification",
  scope: "account",
  payload: z.object({}),
  async handler(ctx) {
    await ctx.tx.insert(notifications).values({
      accountId: ctx.actor.accountId,
      kind: "test",
      text: "Notifications from More are working.",
      dedupeKey: `test:${randomUUID()}`,
    });
    return { queued: true };
  },
});
