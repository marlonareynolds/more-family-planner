import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth";
import { errorResponse, noStore } from "@/server/http";
import { listJournal } from "@/server/queries/journal";

export async function GET(req: Request) {
  try {
    const actor = await requireActor();
    const u = new URL(req.url).searchParams;
    const page = await listJournal(await getDb(), actor, {
      q: u.get("q") ?? undefined,
      tag: u.get("tag") ?? undefined,
      from: u.get("from") ?? undefined,
      to: u.get("to") ?? undefined,
      cursor: u.get("cursor") ?? undefined,
    });
    return Response.json(page, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
