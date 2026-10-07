import { getDb } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { currentActor } from "@/server/auth";
import { assertSameOrigin, errorResponse, noStore } from "@/server/http";
import { assertRate, clientAddress } from "@/server/rate-limit";
import { submitSupport, supportInput } from "@/server/support";

/** A message for whoever runs More. Works signed in or not. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    assertRate(`support:${clientAddress(req)}`, 5, 3_600_000);
    const parsed = supportInput.safeParse(await req.json());
    if (!parsed.success) throw new DomainError("VALIDATION", "Write a few words so we know what it's about.");
    const actor = await currentActor().catch(() => null);
    const { id } = await submitSupport(await getDb(), actor?.accountId ?? null, parsed.data);
    return Response.json({ received: true, reference: id.slice(0, 8) }, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
