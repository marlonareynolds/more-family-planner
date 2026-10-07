import { and, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "@/db/client";
import { accounts, memberships, notifications, pushSubscriptions } from "@/db/schema";
import { BUNDLE_TIMES, MAX_PUSH_ATTEMPTS, PUSH_TTL_MS, bundle, bundleSlotStart, inQuietHours, isTimely, localClock, retryDelayMs, type PushMessage } from "@/domain/reach";
import { addDays, instantToLocalDate, localToInstantCompatible } from "@/domain/time";
import { stillRelevant, type NotifyPayload } from "../outbox";

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
      const res = await webpush.sendNotification(target, JSON.stringify(message), { TTL: message.ttl ?? 6 * 3600, urgency: "normal", topic: message.tag });
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
export const PUSH_WINDOW_MS = PUSH_TTL_MS;
/** How long a worker holds its claim before another run may take over. */
const LEASE_MS = 2 * 60_000;

type Outcome = "sent" | "retry" | "gone";

/**
 * Pushes due notices to each person's devices (R03). Each notice moves
 * through explicit states: a run leases it (so overlapping runs never send
 * it twice, and a crashed run's lease simply runs out), re-checks that it
 * is still true and still theirs, then records what the push service said.
 * A failure is retried with backoff a bounded number of times; a notice
 * past its expiry is marked expired, never sent late. "Sent" means a push
 * service accepted it, not that a phone showed it.
 */
export async function deliverPushes(db: Db, now = new Date(), limit = 200): Promise<{ sent: number; deferred: number; skipped: number; retried: number; expired: number; superseded: number }> {
  const stats = { sent: 0, deferred: 0, skipped: 0, retried: 0, expired: 0, superseded: 0 };
  const nowMs = now.getTime();
  const send = sender ?? defaultSender();

  const due = await db
    .select({ n: notifications, pushEnabled: accounts.pushEnabled, closedAt: accounts.closedAt, quietStart: accounts.quietStart, quietEnd: accounts.quietEnd, timeZone: accounts.timeZone })
    .from(notifications)
    .innerJoin(accounts, eq(accounts.id, notifications.accountId))
    .where(
      and(
        or(inArray(notifications.pushState, ["pending", "retry"]), and(eq(notifications.pushState, "leased"), lt(notifications.pushLeaseUntil, now))),
        or(isNull(notifications.pushNextAt), lte(notifications.pushNextAt, now)),
      ),
    )
    .orderBy(notifications.createdAt)
    .limit(limit);

  const setState = (ids: string[], set: Partial<typeof notifications.$inferInsert>) =>
    ids.length ? db.update(notifications).set(set).where(inArray(notifications.id, ids)) : Promise.resolve();

  const byAccount = new Map<string, typeof due>();
  for (const d of due) byAccount.set(d.n.accountId, [...(byAccount.get(d.n.accountId) ?? []), d]);

  for (const [accountId, list] of byAccount) {
    const first = list[0];
    // Too late to be useful: expire rather than send late.
    const expired = list.filter((d) => nowMs >= (d.n.pushExpiresAt?.getTime() ?? d.n.createdAt.getTime() + PUSH_TTL_MS));
    await setState(expired.map((d) => d.n.id), { pushState: "expired", pushLeaseUntil: null });
    stats.expired += expired.length;
    let live = list.filter((d) => !expired.includes(d));
    if (!live.length) continue;

    const subs = send && first.pushEnabled && !first.closedAt ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.accountId, accountId)) : [];
    if (!subs.length) {
      await setState(live.map((d) => d.n.id), { pushState: "skipped", pushLeaseUntil: null });
      stats.skipped += live.length;
      continue;
    }
    if (inQuietHours(localClock(nowMs, first.timeZone), first.quietStart, first.quietEnd)) {
      stats.deferred += live.length;
      continue;
    }
    // Bundled reminders wait for the next bundle slot, unless something timely is going anyway.
    const timely = live.some((d) => isTimely(d.n.kind));
    if (!timely) {
      const slot = bundleSlotStart(nowMs, first.timeZone, (l) => localToInstantCompatible(l, first.timeZone));
      const [last] = await db
        .select({ at: sql<Date | null>`max(${notifications.pushedAt})` })
        .from(notifications)
        .where(and(eq(notifications.accountId, accountId), eq(notifications.pushState, "sent"), gte(notifications.pushedAt, new Date(slot))));
      if (last?.at) {
        stats.deferred += live.length;
        await setState(live.map((d) => d.n.id), { pushNextAt: new Date(nextSlot(nowMs, first.timeZone)) });
        continue;
      }
    }

    // Claim: only rows still claimable are taken, so two runs can't both send.
    const claimed = await db
      .update(notifications)
      .set({ pushState: "leased", pushLeaseUntil: new Date(nowMs + LEASE_MS), pushAttempts: sql`${notifications.pushAttempts} + 1` })
      .where(
        and(
          inArray(notifications.id, live.map((d) => d.n.id)),
          or(inArray(notifications.pushState, ["pending", "retry"]), and(eq(notifications.pushState, "leased"), lt(notifications.pushLeaseUntil, now))),
        ),
      )
      .returning({ id: notifications.id, attempts: notifications.pushAttempts });
    live = live.filter((d) => claimed.some((c) => c.id === d.n.id));
    if (!live.length) continue;

    // Still true, and still theirs, right now?
    const stale: string[] = [];
    for (const d of live) if (!(await stillTrue(db, d.n, now))) stale.push(d.n.id);
    await setState(stale, { pushState: "superseded", pushLeaseUntil: null });
    stats.superseded += stale.length;
    live = live.filter((d) => !stale.includes(d.n.id));
    if (!live.length) continue;

    const message = bundle(live.map((d) => ({ text: d.n.text, url: urlFor(d.n) })))!;
    const soonest = Math.min(...live.map((d) => d.n.pushExpiresAt?.getTime() ?? d.n.createdAt.getTime() + PUSH_TTL_MS));
    message.ttl = Math.max(60, Math.round((soonest - nowMs) / 1000));
    const outcomes: Outcome[] = [];
    let error: string | null = null;
    for (const s of subs) {
      let status = 0;
      try {
        status = await send!({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message);
      } catch (err) {
        error = String((err as Error)?.message ?? err).slice(0, 200);
      }
      if (status === 404 || status === 410) {
        // The device unsubscribed or the app was removed.
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        outcomes.push("gone");
      } else if (status >= 200 && status < 300) {
        await db.update(pushSubscriptions).set({ lastSuccessAt: now, failures: 0 }).where(eq(pushSubscriptions.id, s.id));
        outcomes.push("sent");
      } else {
        error ??= `status ${status}`;
        await db.update(pushSubscriptions).set({ failures: sql`${pushSubscriptions.failures} + 1` }).where(eq(pushSubscriptions.id, s.id));
        await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, s.id), gt(pushSubscriptions.failures, 9)));
        outcomes.push("retry");
      }
    }
    const ids = live.map((d) => d.n.id);
    if (outcomes.includes("sent")) {
      await setState(ids, { pushState: "sent", pushedAt: now, pushLeaseUntil: null, pushError: outcomes.includes("retry") ? `some devices failed: ${error}` : null });
      stats.sent += ids.length;
    } else if (outcomes.includes("retry")) {
      const attempts = Math.max(...claimed.filter((c) => ids.includes(c.id)).map((c) => c.attempts));
      if (attempts >= MAX_PUSH_ATTEMPTS) {
        await setState(ids, { pushState: "failed", pushLeaseUntil: null, pushError: error });
      } else {
        await setState(ids, { pushState: "retry", pushLeaseUntil: null, pushNextAt: new Date(nowMs + retryDelayMs(attempts)), pushError: error });
        stats.retried += ids.length;
      }
    } else {
      await setState(ids, { pushState: "skipped", pushLeaseUntil: null, pushError: "no devices left" });
      stats.skipped += ids.length;
    }
  }
  return stats;
}

function nextSlot(nowMs: number, timeZone: string): number {
  const today = instantToLocalDate(nowMs, timeZone);
  const all = [today, addDays(today, 1)].flatMap((d) => BUNDLE_TIMES.map((t) => localToInstantCompatible(`${d}T${t}`, timeZone)));
  return Math.min(...all.filter((c) => c > nowMs));
}

/** The source is still current and the person is still in that household. */
async function stillTrue(db: Db, n: typeof notifications.$inferSelect, now: Date): Promise<boolean> {
  if (n.householdId) {
    const [m] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.householdId, n.householdId), eq(memberships.accountId, n.accountId), isNull(memberships.endsAt)));
    if (!m) return false;
  }
  if (!n.relevance) return true;
  return stillRelevant(db, n.relevance as NotifyPayload, now);
}
