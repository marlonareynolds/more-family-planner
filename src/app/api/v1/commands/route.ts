import { after } from "next/server";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth";
import { executeCommand } from "@/server/commands";
import { assertSameOrigin, errorResponse, noStore } from "@/server/http";
import { afterChange } from "@/server/tick";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const actor = await requireActor();
    const body = await req.json();
    const result = await executeCommand(actor, body);
    // Deliver whatever this change made due straight away; the daily cron
    // only catches anything left behind (future reminders, failed runs).
    after(async () => {
      try {
        await afterChange(await getDb());
      } catch (err) {
        console.error("outbox drain after command failed", err);
      }
    });
    return Response.json(result, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
