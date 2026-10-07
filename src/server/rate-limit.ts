import { DomainError } from "@/domain/errors";

/**
 * A small fixed-window limiter kept in each server instance's memory. It
 * costs nothing and needs no store, so it is a speed bump rather than a
 * wall: each warm instance counts on its own. It is enough to stop a
 * runaway script or someone guessing at no-account links.
 */
const windows = new Map<string, { start: number; count: number }>();
const MAX_KEYS = 10_000;

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

/** The caller's address as Vercel reports it. */
export function clientAddress(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export function assertRate(key: string, limit: number, windowMs: number): void {
  if (!rateLimit(key, limit, windowMs)) throw new DomainError("RATE_LIMITED", "That's a lot of requests at once. Wait a minute and try again.");
}

/** Tests start clean. */
export function resetRateLimits(): void {
  windows.clear();
}
