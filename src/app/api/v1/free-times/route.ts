import { z } from "zod";
import { getDb } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { requireActor } from "@/server/auth";
import { errorResponse, noStore } from "@/server/http";
import { freeTimesFor } from "@/server/queries/free-time";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const query = z.object({
  kind: z.enum(["me", "us", "family"]),
  minutes: z.coerce.number().int().min(30).max(720),
  /** Optional start window, for plans tied to a time of day. */
  after: clock.optional(),
  before: clock.optional(),
});

export async function GET(req: Request) {
  try {
    const actor = await requireActor();
    const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) throw new DomainError("VALIDATION", "Choose a kind of time and a length.");
    const { kind, minutes, after, before } = parsed.data;
    const window = after && before ? ([after, before] as const) : undefined;
    return Response.json(await freeTimesFor(await getDb(), actor, kind, minutes, new Date(), 14, window), { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
