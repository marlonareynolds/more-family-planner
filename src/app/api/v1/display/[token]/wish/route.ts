import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { assertRate, clientAddress } from "@/server/rate-limit";
import { assertSameOrigin, errorResponse, noStore } from "@/server/http";
import { makeWish } from "@/server/queries/display";
import { afterChange } from "@/server/tick";

const body = z.object({ activityKey: z.string().min(1).max(80) });

/** A child's pick from their own screen. The link is the only credential. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/display/[token]/wish">) {
  try {
    assertSameOrigin(req);
    assertRate(`wish:${clientAddress(req)}`, 10, 60_000);
    const { token } = await ctx.params;
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new DomainError("VALIDATION", "That pick wasn't understood.");
    const db = await getDb();
    const view = await makeWish(db, token, parsed.data.activityKey);
    if (!view) throw new DomainError("NOT_FOUND", "This screen's link isn't valid any more.");
    after(() => afterChange(db).catch(() => {}));
    return Response.json({ wish: view.wish }, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
