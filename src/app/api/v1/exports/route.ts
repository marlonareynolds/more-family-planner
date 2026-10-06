import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth";
import { errorResponse } from "@/server/http";
import { exportAccount, exportHousehold } from "@/server/queries/exports";

export async function GET(req: Request) {
  try {
    const actor = await requireActor();
    const kind = new URL(req.url).searchParams.get("kind") === "household" ? "household" : "account";
    const db = await getDb();
    const data = kind === "household" ? await exportHousehold(db, actor) : await exportAccount(db, actor);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="more-${kind}-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
