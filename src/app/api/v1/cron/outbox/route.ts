import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { runTick } from "@/server/tick";

export const maxDuration = 60;

/**
 * The scheduled tick: Vercel Cron daily and GitHub Actions every 15 minutes,
 * both with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Not found", { status: 404 });
  }
  const stats = await runTick(await getDb());
  return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
}
