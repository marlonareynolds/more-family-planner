import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { rateLimits } from "@/db/schema";
import { DomainError } from "@/domain/errors";

/**
 * Fixed-window rate limits counted in Postgres, so every server instance
 * shares one count: a wall, not a per-instance speed bump. One upsert per
 * request, in the same London region as the app.
 *
 * If the database can't be reached the limiter falls back to counting in
 * this instance's memory rather than refusing everyone: the request would
 * fail on its own database work anyway, and a limiter must never be the
 * thing that takes More down.
 */

const windows = new Map<string, { start: number; count: number }>();
const MAX_KEYS = 10_000;

/** The in-memory fallback: each warm instance counts on its own. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    if (windows.size >= MAX_KEYS) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
      if (windows.size >= MAX_KEYS) windows.clear();
    }
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= limit;
}

/** Keys name an account or an address; only a hash of them is stored. */
function storedKey(key: string, windowMs: number): string {
  return createHash("sha256").update(`${windowMs}:${key}`).digest("base64url").slice(0, 32);
}

/**
 * Count one request against a limit shared by all instances. A request
 * stamped with an older window than the stored one (clocks differ slightly
 * between instances) counts towards the newer window, never resets it.
 */
export async function sharedRateLimit(db: Db, key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const bucket = Math.floor(now / windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key: storedKey(key, windowMs), bucket, count: 1, expiresAt: new Date((bucket + 1) * windowMs) })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when excluded.bucket > ${rateLimits.bucket} then 1 else ${rateLimits.count} + 1 end`,
        bucket: sql`greatest(${rateLimits.bucket}, excluded.bucket)`,
        expiresAt: sql`greatest(${rateLimits.expiresAt}, excluded.expires_at)`,
      },
    })
    .returning({ count: rateLimits.count });
  return (row?.count ?? 1) <= limit;
}

let warned = false;

/** True while the caller is within the limit. Shared when the database answers, per instance when it doesn't. */
export async function allowRequest(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    return await sharedRateLimit(await getDb(), key, limit, windowMs);
  } catch (err) {
    if (!warned) {
      warned = true;
      console.error("shared rate limit unavailable, counting in memory", (err as Error)?.message);
    }
    return rateLimit(key, limit, windowMs);
  }
}

/** The caller's address as Vercel reports it. */
export function clientAddress(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function assertRate(key: string, limit: number, windowMs: number): Promise<void> {
  if (!(await allowRequest(key, limit, windowMs))) throw new DomainError("RATE_LIMITED", "That's a lot of requests at once. Wait a minute and try again.");
}

/** The scheduler's sweep: windows that have ended hold nothing worth keeping. */
export async function pruneRateLimits(db: Db, now = new Date()): Promise<number> {
  const gone = await db.delete(rateLimits).where(lt(rateLimits.expiresAt, now)).returning({ key: rateLimits.key });
  return gone.length;
}

/** Tests start clean. */
export function resetRateLimits(): void {
  windows.clear();
}
