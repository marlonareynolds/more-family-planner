import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "@/db/client";
import { accounts, notifications, pushSubscriptions } from "@/db/schema";
import { bundle, inQuietHours, localClock, type PushMessage } from "@/domain/reach";

/**
 * Web push to installed devices (spec 13.2). It uses the browser's own push
 * service: no provider and no per-message cost. Without VAPID keys this is
 * a no-op and More stays in-app only.
 */

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Returns the HTTP status from the push service. */
export type PushSender = (target: PushTarget, message: PushMessage) => Promise<number>;

let sender: PushSender | null = null;

/** Tests swap the network out. */
export function setPushSender(fn: PushSender | null): void {
  sender = fn;
}

export function vapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

function defaultSender(): PushSender | null {
  const publicKey = vapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@example.com", publicKey, privateKey);
  return async (target, message) => {
    try {
      const res = await webpush.sendNotification(target, JSON.stringify(message), { TTL: 6 * 3600, urgency: "normal", topic: message.tag });
      return res.statusCode;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status) return status;
      throw err;
    }
  };
}

export function pushConfigured(): boolean {
  return !!(sender ?? defaultSender());
}

/** Where a notification should open. */
function urlFor(n: { sourceType: string | null; kind: string }): string {
  if (n.sourceType === "care") return "/holidays";
  if (n.kind.startsWith("ritual")) return "/today";
  return "/today";
}

/** Anything older than this is no longer news, so it is never pushed late. */
export const PUSH_WINDOW_MS = 16 * 3_600_000;

export async function deliverPushes(db: Db, now = new Date(), limit = 200): Promise<{ sent: number; deferred: number; skipped: number }> {
  const stats = { sent: 0, deferred: 0, skipped: 0 };
  const send = sender ?? defaultSender();
  if (!send) return stats;
  const pending = await db
    .select({
      id: notifications.id,
      accountId: notifications.accountId,
      text: notifications.text,
      kind: notifications.kind,
      sourceType: notifications.sourceType,
      createdAt: notifications.createdAt,
      pushEnabled: accounts.pushEnabled,
      quietStart: accounts.quietStart,
      quietEnd: accounts.quietEnd,
      timeZone: accounts.timeZone,
    })
    .from(notifications)
    .innerJoin(accounts, eq(accounts.id, notifications.accountId))
    .where(and(isNull(notifications.pushedAt), gt(notifications.createdAt, new Date(now.getTime() - PUSH_WINDOW_MS))))
    .orderBy(notifications.createdAt)
    .limit(limit);

  const byAccount = new Map<string, typeof pending>();
  for (const n of pending) byAccount.set(n.accountId, [...(byAccount.get(n.accountId) ?? []), n]);

  for (const [accountId, list] of byAccount) {
    const first = list[0];
    const subs = first.pushEnabled ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.accountId, accountId)) : [];
    if (subs.length && inQuietHours(localClock(now.getTime(), first.timeZone), first.quietStart, first.quietEnd)) {
      stats.deferred += list.length;
      continue;
    }
    // Claim before sending so two runs never push the same thing twice.
    const claimed = await db
      .update(notifications)
      .set({ pushedAt: now })
      .where(and(inArray(notifications.id, list.map((n) => n.id)), isNull(notifications.pushedAt)))
      .returning({ id: notifications.id });
    const mine = list.filter((n) => claimed.some((c) => c.id === n.id));
    if (!subs.length || !mine.length) {
      stats.skipped += mine.length;
      continue;
    }
    const message = bundle(mine.map((n) => ({ text: n.text, url: urlFor(n) })))!;
    for (const s of subs) {
      let status = 0;
      try {
        status = await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message);
      } catch {
        status = 0;
      }
      if (status === 404 || status === 410) {
        // The device unsubscribed or the app was removed.
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      } else if (status >= 200 && status < 300) {
        await db.update(pushSubscriptions).set({ lastSuccessAt: now, failures: 0 }).where(eq(pushSubscriptions.id, s.id));
        stats.sent++;
      } else {
        await db.update(pushSubscriptions).set({ failures: sql`${pushSubscriptions.failures} + 1` }).where(eq(pushSubscriptions.id, s.id));
        await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, s.id), gt(pushSubscriptions.failures, 9)));
      }
    }
  }
  return stats;
}
