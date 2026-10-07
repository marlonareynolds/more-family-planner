import { getDb } from "@/db/client";
import { authorizedCron } from "@/server/ops/cron-auth";
import { runTick } from "@/server/tick";

export const maxDuration = 60;

/**
 * The scheduled tick: Supabase cron every 5 minutes and Vercel Cron daily,
 * both with `Authorization: Bearer $CRON_SECRET`. Answers 500 when any step
 * failed, so the failure shows in the scheduler's history and Vercel's logs.
 */
export async function GET(req: Request) {
  if (!authorizedCron(req)) return new Response("Not found", { status: 404 });
  const { stats, errors } = await runTick(await getDb());
  if (errors.length) console.error("[tick]", errors.join("; "));
  return Response.json({ ok: errors.length === 0, errors, stats }, { status: errors.length ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
