import { getDb } from "@/db/client";
import { calendarFeed } from "@/server/queries/calendar-out";
import { clientAddress, rateLimit } from "@/server/rate-limit";

/**
 * The private calendar subscription feed. The token in the path is the only
 * credential and names one adult; calendar apps fetch it every few hours.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/calendar/[token]">) {
  // Calendar apps share addresses, so this is generous; it stops link guessing.
  if (!rateLimit(`ics:${clientAddress(req)}`, 120, 60_000)) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const { token } = await ctx.params;
  const db = await getDb();
  const body = await calendarFeed(db, token.replace(/\.ics$/, ""));
  if (body === null) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="more.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
