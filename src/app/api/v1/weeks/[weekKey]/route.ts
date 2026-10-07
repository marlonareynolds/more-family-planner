import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth";
import { errorResponse, noStore } from "@/server/http";
import { getWeek } from "@/server/queries/week";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/weeks/[weekKey]">) {
  try {
    const actor = await requireActor();
    const { weekKey } = await ctx.params;
    const week = await getWeek(await getDb(), actor, weekKey);
    return Response.json(week, { headers: { ...noStore, ETag: `"${week.household.scheduleRevision}-${week.household.membershipRevision}"` } });
  } catch (err) {
    return errorResponse(err);
  }
}
