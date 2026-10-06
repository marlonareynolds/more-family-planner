import { requireActor } from "@/server/auth";
import { executeCommand } from "@/server/commands";
import { assertSameOrigin, errorResponse, noStore } from "@/server/http";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const actor = await requireActor();
    const body = await req.json();
    const result = await executeCommand(actor, body);
    return Response.json(result, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
