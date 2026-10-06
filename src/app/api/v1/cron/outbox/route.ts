import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { processOutbox } from "@/server/outbox";

/** Called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Not found", { status: 404 });
  }
  const stats = await processOutbox(await getDb());
  return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
}
