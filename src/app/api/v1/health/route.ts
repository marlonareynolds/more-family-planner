import { getDb } from "@/db/client";
import { authorizedCron } from "@/server/ops/cron-auth";
import { healthChecks, healthy } from "@/server/ops/health";

/**
 * Operator health: scheduler freshness, overdue work, delivery failures and
 * waiting support messages. Counts only. Same bearer secret as the cron;
 * answers 503 when something needs attention, so a monitor can alert on it.
 */
export async function GET(req: Request) {
  if (!authorizedCron(req)) return new Response("Not found", { status: 404 });
  const checks = await healthChecks(await getDb());
  const ok = healthy(checks);
  return Response.json({ ok, checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
