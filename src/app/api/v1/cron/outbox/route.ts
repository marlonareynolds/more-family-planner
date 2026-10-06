import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { syncDue } from "@/server/calendar-sync";
import { processOutbox } from "@/server/outbox";

export const maxDuration = 60;

/** Called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Not found", { status: 404 });
  }
  const db = await getDb();
  const stats = await processOutbox(db);
  // Calendars nobody has looked at for a while still refresh daily.
  const calendars = await syncDue(db, 6 * 3_600_000, { limit: 40 });
  return Response.json({ ...stats, calendars }, { headers: { "Cache-Control": "no-store" } });
}
