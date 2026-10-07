import { z } from "zod";
import { getDb } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { answerAsk } from "@/server/commands/village";
import { assertRate, clientAddress } from "@/server/rate-limit";
import { assertSameOrigin, errorResponse, noStore } from "@/server/http";
import { afterChange } from "@/server/tick";
import { after } from "next/server";

const body = z.object({ response: z.enum(["yes", "no"]) });

/** A helper's answer. The token is the only credential: it names one ask. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/asks/[token]">) {
  try {
    assertSameOrigin(req);
    assertRate(`ask:${clientAddress(req)}`, 20, 60_000);
    const { token } = await ctx.params;
    const parsed = body.safeParse(await req.json());
    if (!parsed.success || token.length < 10 || token.length > 100) throw new DomainError("VALIDATION", "That answer wasn't understood.");
    const db = await getDb();
    const view = await answerAsk(db, token, parsed.data.response);
    if (!view) throw new DomainError("NOT_FOUND", "This link isn't valid any more.");
    after(() => afterChange(db).catch(() => {}));
    return Response.json({ response: view.response, open: view.open }, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
