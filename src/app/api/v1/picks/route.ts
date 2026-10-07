import { z } from "zod";
import { getDb } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { requireActor } from "@/server/auth";
import { errorResponse, noStore } from "@/server/http";
import { picksFor } from "@/server/queries/picks";

const query = z.object({ kind: z.enum(["me", "us", "family"]) });

/** This fortnight's picks: ideas paired with a free time and who covers the children. */
export async function GET(req: Request) {
  try {
    const actor = await requireActor();
    const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) throw new DomainError("VALIDATION", "Choose a kind of time.");
    return Response.json(await picksFor(await getDb(), actor, parsed.data.kind), { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
