import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { requireActor } from "@/server/auth";
import { assertSameOrigin, errorResponse, noStore } from "@/server/http";
import { leaveHousehold } from "@/server/leaving";
import { assertRate } from "@/server/rate-limit";
import { afterChange } from "@/server/tick";

export const maxDuration = 60;

const body = z.object({
  householdId: z.uuid(),
  how: z.discriminatedUnion("command", [
    z.object({ command: z.literal("LeaveHousehold"), payload: z.object({ confirm: z.literal(true) }) }),
    z.object({ command: z.literal("DeleteHousehold"), payload: z.object({ confirmName: z.string().max(200) }) }),
  ]),
});

/**
 * Leave or delete a household. More's "Busy" blocks in a connected Google or
 * Outlook calendar are taken out first; any that can't be are listed back.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const actor = await requireActor();
    assertRate(`cmd:${actor.accountId}`, 120, 60_000);
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new DomainError("VALIDATION", "Refresh and try again.");
    const db = await getDb();
    const result = await leaveHousehold(db, actor, parsed.data.householdId, parsed.data.how);
    after(async () => {
      try {
        await afterChange(await getDb());
      } catch (err) {
        console.error("outbox drain after leaving failed", err);
      }
    });
    return Response.json(result, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
