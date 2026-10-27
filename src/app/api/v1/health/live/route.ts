import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { clientAddress, rateLimit } from "@/server/rate-limit";

/**
 * For an outside uptime monitor: is the app up and can it reach its
 * database? No secret needed and nothing in the answer but up or down. The
 * per-instance limiter is enough here and keeps this off the shared table.
 */
export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!rateLimit(`live:${clientAddress(req)}`, 30, 60_000)) return new Response("Too many requests", { status: 429, headers });
  try {
    await (await getDb()).execute(sql`select 1`);
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
