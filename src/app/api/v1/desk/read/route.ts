import { getDb } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { requireActor } from "@/server/auth";
import { deskAiEnabled, deskInput, readWithAi } from "@/server/desk-ai";
import { assertSameOrigin, errorResponse, noStore } from "@/server/http";
import { assertRate } from "@/server/rate-limit";

export const maxDuration = 120;

/** Read a letter, photo or PDF with the AI reader. Nothing is stored. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req, 4_500_000);
    const actor = await requireActor();
    assertRate(`desk-ai:${actor.accountId}`, 30, 3_600_000);
    const parsed = deskInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new DomainError("VALIDATION", "That file is too large or not a photo or PDF.");
    const { items, unreadable } = await readWithAi(await getDb(), actor, parsed.data);
    return Response.json({ items, unreadable }, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Whether the AI reader is switched on here. Says nothing about the key itself. */
export function GET() {
  return Response.json({ ai: deskAiEnabled() }, { headers: noStore });
}
