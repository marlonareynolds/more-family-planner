import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { calendarFeeds, calendarPushes, events, households, memberships } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { parseIcs, type ImportedOccurrence } from "@/domain/ics";
import { instantToLocal } from "@/domain/time";
import { deleteBusy, freshTokens, listBusy, putBusy, ProviderError, ReconnectNeeded, type HttpFetch, type Provider, type Tokens } from "./calendar-providers";
import { loadBusy } from "./queries/busy";
import { seal, unseal } from "./secret-box";

/**
 * Calendar import (spec 8.11). A sync reads the adult's calendar (an
 * iCalendar link, or a signed-in Google or Outlook account), expands it for
 * a window, and replaces that feed's imported copies in one transaction.
 * Their events are never changed; a signed-in account can also receive
 * More's own plans as plain "Busy" blocks, which More alone manages.
 * Failures are recorded on the feed and shown to the adult, never hidden.
 */

export const SYNC_PAST_DAYS = 14;
export const SYNC_FUTURE_DAYS = 180;
/** After this long without a successful sync, availability is uncertain. */
export const STALE_AFTER_MS = 24 * 3_600_000;
const MAX_BYTES = 5 * 1024 * 1024;

export type FetchText = (url: string) => Promise<string>;

/** webcal:// is https by another name; anything else must already be https. */
export function normaliseFeedUrl(raw: string): string {
  const trimmed = raw.trim().replace(/^webcals?:\/\//i, "https://");
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new DomainError("VALIDATION", "Paste the calendar's full link, starting https:// or webcal://.");
  }
  if (u.protocol !== "https:") throw new DomainError("VALIDATION", "Use the calendar's secure link (https:// or webcal://).");
  if (u.username || u.password) throw new DomainError("VALIDATION", "That link has a password in it; use the private address link instead.");
  return u.toString();
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

class SyncError extends Error {
  constructor(public code: "unreachable" | "blocked_address" | "too_large" | "not_calendar" | "http_error") {
    super(code);
  }
}

/** Fetch a public https URL: no internal addresses, bounded size and time. */
export const fetchFeed: FetchText = async (start) => {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new SyncError("blocked_address");
    const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true }).catch(() => []);
    if (addrs.length === 0) throw new SyncError("unreachable");
    if (addrs.some((a) => privateAddress(a.address))) throw new SyncError("blocked_address");
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { Accept: "text/calendar, */*;q=0.5", "User-Agent": "More calendar import" } });
    } catch {
      throw new SyncError("unreachable");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    if (!res.ok) throw new SyncError("http_error");
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new SyncError("too_large");
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new SyncError("too_large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new SyncError("unreachable");
};

export interface SyncResult {
  ok: boolean;
  imported: number;
  error?: string;
}

function rowFor(o: ImportedOccurrence, feed: typeof calendarFeeds.$inferSelect, timeZone: string) {
  const local = instantToLocal(o.start, timeZone).toString().slice(0, 16);
  const minutes = Math.max(1, Math.round((o.end - o.start) / 60_000));
  return {
    householdId: feed.householdId,
    ownerId: feed.accountId,
    title: o.title,
    visibility: feed.visibility,
    allDay: o.allDay,
    timeZone,
    startAt: new Date(o.start),
    endAt: new Date(o.end),
    localStart: o.allDay ? `${o.startDate}T00:00` : local,
    durationMinutes: minutes,
    rule: null,
    seriesEndAt: new Date(o.end),
    adultIds: [feed.accountId],
    feedId: feed.id,
    externalId: o.externalId,
  };
}

/** How far ahead More writes its plans into a connected calendar. */
export const WRITE_AHEAD_DAYS = 90;

export async function syncFeed(db: Db, feedId: string, fetchText: FetchText = fetchFeed, now = new Date(), http: HttpFetch = fetch): Promise<SyncResult> {
  const [feed] = await db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feedId));
  if (!feed) return { ok: false, imported: 0, error: "not_found" };
  const [household] = await db.select().from(households).where(eq(households.id, feed.householdId));
  const fail = async (code: string): Promise<SyncResult> => {
    await db.update(calendarFeeds).set({ lastAttemptAt: now, lastError: code }).where(eq(calendarFeeds.id, feed.id));
    return { ok: false, imported: 0, error: code };
  };
  if (!household || household.deletedAt) return fail("household_gone");

  const window = { start: now.getTime() - SYNC_PAST_DAYS * 86_400_000, end: now.getTime() + SYNC_FUTURE_DAYS * 86_400_000 };
  let occurrences: ImportedOccurrence[];
  let access: { provider: Provider; token: string } | null = null;
  try {
    if (feed.provider === "ics") {
      occurrences = parseIcs(await fetchText(feed.url), window, household.timeZone);
    } else {
      if (!feed.credentials) return fail("reconnect");
      const fresh = await freshTokens(feed.provider, JSON.parse(unseal(feed.credentials)) as Tokens, http, now.getTime());
      if (fresh.changed) await db.update(calendarFeeds).set({ credentials: seal(JSON.stringify(fresh.tokens)) }).where(eq(calendarFeeds.id, feed.id));
      access = { provider: feed.provider, token: fresh.tokens.access };
      occurrences = await listBusy(feed.provider, access.token, window, household.timeZone, http);
    }
  } catch (err) {
    if (err instanceof SyncError) return fail(err.code);
    if (err instanceof ReconnectNeeded) return fail("reconnect");
    if (err instanceof ProviderError) return fail("http_error");
    if (err instanceof DomainError) return fail("not_calendar");
    return fail("unreachable");
  }

  await db.transaction(async (tx) => {
    // Serialise with commands on this household; re-check the feed still exists.
    await tx.select({ id: households.id }).from(households).where(eq(households.id, household.id)).for("update");
    const [still] = await tx.select({ id: calendarFeeds.id }).from(calendarFeeds).where(eq(calendarFeeds.id, feed.id));
    const [member] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.householdId, household.id), eq(memberships.accountId, feed.accountId), isNull(memberships.endsAt)));
    if (!still || !member) return;

    const existing = await tx
      .select({ id: events.id, externalId: events.externalId })
      .from(events)
      .where(and(eq(events.feedId, feed.id), gte(events.endAt, new Date(window.start))));
    const seen = new Set<string>();
    for (const o of occurrences) {
      seen.add(o.externalId);
      const values = rowFor(o, feed, household.timeZone);
      await tx
        .insert(events)
        .values(values)
        .onConflictDoUpdate({
          target: [events.feedId, events.externalId],
          targetWhere: sql`${events.feedId} is not null`,
          set: {
            title: values.title,
            visibility: values.visibility,
            allDay: values.allDay,
            startAt: values.startAt,
            endAt: values.endAt,
            localStart: values.localStart,
            durationMinutes: values.durationMinutes,
            seriesEndAt: values.seriesEndAt,
            cancelledAt: null,
            version: sql`${events.version} + 1`,
          },
        });
    }
    // Items gone from the provider inside the window are removed here only.
    const gone = existing.filter((e) => !seen.has(e.externalId!)).map((e) => e.id);
    for (let i = 0; i < gone.length; i += 500) await tx.delete(events).where(inArray(events.id, gone.slice(i, i + 500)));
    await tx
      .update(calendarFeeds)
      .set({ lastAttemptAt: now, lastSuccessAt: now, lastError: null, eventCount: occurrences.length })
      .where(eq(calendarFeeds.id, feed.id));
    await tx.update(households).set({ scheduleRevision: sql`${households.scheduleRevision} + 1` }).where(eq(households.id, household.id));
  });
  if (access && feed.writeBusy) {
    const written = await writeBusy(db, feed, access, now, http).catch((err) => (err instanceof ReconnectNeeded ? "reconnect" : "write_failed"));
    if (typeof written === "string") {
      await db.update(calendarFeeds).set({ lastError: written }).where(eq(calendarFeeds.id, feed.id));
      return { ok: false, imported: occurrences.length, error: written };
    }
  }
  return { ok: true, imported: occurrences.length };
}

/**
 * Make the connected calendar match what occupies this adult in More: agreed
 * plans, children they've agreed to look after, and time away. Each is a
 * plain "Busy" block; details never leave More.
 */
export async function writeBusy(db: Db, feed: typeof calendarFeeds.$inferSelect, access: { provider: Provider; token: string }, now = new Date(), http: HttpFetch = fetch): Promise<{ written: number; removed: number }> {
  const window = { start: now.getTime(), end: now.getTime() + WRITE_AHEAD_DAYS * 86_400_000 };
  const wanted = new Map<string, { start: number; end: number }>();
  for (const b of await loadBusy(db, feed.householdId, window)) {
    if (b.personId !== feed.accountId || b.end <= window.start || b.start >= window.end) continue;
    if (b.sourceType !== "date" && b.sourceType !== "care" && b.sourceType !== "trip") continue;
    wanted.set(`${b.sourceType}:${b.sourceId}`, { start: b.start, end: b.end });
  }
  const pushed = await db.select().from(calendarPushes).where(eq(calendarPushes.feedId, feed.id));
  let written = 0;
  let removed = 0;
  for (const [sourceKey, block] of wanted) {
    const fingerprint = `${block.start}-${block.end}`;
    const prior = pushed.find((x) => x.sourceKey === sourceKey);
    if (prior?.fingerprint === fingerprint) continue;
    const externalId = await putBusy(access.provider, access.token, prior?.externalId ?? null, block, http);
    await db
      .insert(calendarPushes)
      .values({ feedId: feed.id, sourceKey, externalId, fingerprint, updatedAt: now })
      .onConflictDoUpdate({ target: [calendarPushes.feedId, calendarPushes.sourceKey], set: { externalId, fingerprint, updatedAt: now } });
    written++;
  }
  // Plans that ended early, were cancelled or moved out of reach: take the block away.
  for (const x of pushed.filter((x) => !wanted.has(x.sourceKey))) {
    await deleteBusy(access.provider, access.token, x.externalId, http);
    await db.delete(calendarPushes).where(and(eq(calendarPushes.feedId, feed.id), eq(calendarPushes.sourceKey, x.sourceKey)));
    removed++;
  }
  return { written, removed };
}

/** Before disconnecting: take every block More wrote back out of the calendar. */
export async function clearPushedBusy(db: Db, feedId: string, http: HttpFetch = fetch, now = new Date()): Promise<void> {
  const [feed] = await db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feedId));
  if (!feed || feed.provider === "ics" || !feed.credentials) return;
  const pushed = await db.select().from(calendarPushes).where(eq(calendarPushes.feedId, feed.id));
  if (!pushed.length) return;
  const { tokens } = await freshTokens(feed.provider, JSON.parse(unseal(feed.credentials)) as Tokens, http, now.getTime());
  for (const x of pushed) {
    await deleteBusy(feed.provider, tokens.access, x.externalId, http).catch(() => {});
    await db.delete(calendarPushes).where(and(eq(calendarPushes.feedId, feed.id), eq(calendarPushes.sourceKey, x.sourceKey)));
  }
}

interface SyncOpts {
  accountId?: string;
  limit?: number;
  /** Only signed-in accounts, which carry More's plans back out as busy. */
  connected?: boolean;
}

/** Feeds that haven't been tried for `olderThanMs`, oldest first. */
export async function dueFeeds(db: Db, olderThanMs: number, opts: SyncOpts = {}, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - olderThanMs);
  const rows = await db
    .select({ id: calendarFeeds.id })
    .from(calendarFeeds)
    .where(and(opts.accountId ? eq(calendarFeeds.accountId, opts.accountId) : undefined, opts.connected ? ne(calendarFeeds.provider, "ics") : undefined, or(isNull(calendarFeeds.lastAttemptAt), lt(calendarFeeds.lastAttemptAt, cutoff))))
    .orderBy(sql`${calendarFeeds.lastAttemptAt} asc nulls first`)
    .limit(opts.limit ?? 50);
  return rows.map((r) => r.id);
}

export async function syncDue(db: Db, olderThanMs: number, opts: SyncOpts = {}): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  for (const id of await dueFeeds(db, olderThanMs, opts)) {
    const r = await syncFeed(db, id).catch(() => ({ ok: false }) as SyncResult);
    if (r.ok) synced++;
    else failed++;
  }
  return { synced, failed };
}
