import { z } from "zod";
import { getDb } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { requireActor } from "@/server/auth";
import { checkDesk, deskCheckInput } from "@/server/desk";
import { assertSameOrigin, errorResponse, noStore } from "@/server/http";
import { assertRate } from "@/server/rate-limit";

const body = z.object({ householdId: z.uuid(), items: z.array(deskCheckInput).max(60) });

/** Which of the Desk's cards are already in the diary, changed, or moved. Fingerprints in; nothing stored. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req, 200_000);
    const actor = await requireActor();
    assertRate(`desk-check:${actor.accountId}`, 120, 3_600_000);
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new DomainError("VALIDATION", "Those cards couldn't be checked.");
    return Response.json({ statuses: await checkDesk(await getDb(), actor, parsed.data.householdId, parsed.data.items) }, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
