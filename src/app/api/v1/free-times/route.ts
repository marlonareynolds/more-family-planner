import { z } from "zod";
import { getDb } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { requireActor } from "@/server/auth";
import { errorResponse, noStore } from "@/server/http";
import { freeTimesFor } from "@/server/queries/free-time";

const query = z.object({ kind: z.enum(["me", "us", "family"]), minutes: z.coerce.number().int().min(30).max(720) });

export async function GET(req: Request) {
  try {
    const actor = await requireActor();
    const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) throw new DomainError("VALIDATION", "Choose a kind of time and a length.");
    return Response.json(await freeTimesFor(await getDb(), actor, parsed.data.kind, parsed.data.minutes), { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
