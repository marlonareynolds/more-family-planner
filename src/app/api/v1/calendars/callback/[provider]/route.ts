import { and, count, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { calendarFeeds, households } from "@/db/schema";
import { requireActor } from "@/server/auth";
import { PROVIDERS, PROVIDER_NAME, exchangeCode, type Provider } from "@/server/calendar-providers";
import { syncFeed } from "@/server/calendar-sync";
import { householdFor } from "@/server/queries/week";
import { seal, verifySigned } from "@/server/secret-box";

export const maxDuration = 60;
const STATE_COOKIE = "more_calendar_state";

/** The provider sends the adult back here; store the grant and read the calendar once. */
export async function GET(req: Request, { params }: RouteContext<"/api/v1/calendars/callback/[provider]">) {
  const back = (result: string) => NextResponse.redirect(new URL(`/settings?calendar=${result}#calendars`, req.url));
  try {
    const actor = await requireActor();
    const { provider } = await params;
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = verifySigned(url.searchParams.get("state") ?? "", "calendar-oauth");
    const jar = await cookies();
    const nonce = jar.get(STATE_COOKIE)?.value;
    jar.delete({ name: STATE_COOKIE, path: "/api/v1/calendars" });
    if (!PROVIDERS.includes(provider as Provider)) return back("unavailable");
    if (url.searchParams.get("error")) return back("cancelled");
    const [accountId, p, expires, stateNonce] = state?.split(".") ?? [];
    if (!code || !state || accountId !== actor.accountId || p !== provider || Number(expires) < Date.now() || !nonce || nonce !== stateNonce) return back("expired");

    const db = await getDb();
    const household = await householdFor(db, actor);
    if (!household) return back("expired");
    const { tokens, email } = await exchangeCode(provider as Provider, code);
    const label = email ? `${PROVIDER_NAME[provider as Provider]} (${email})` : PROVIDER_NAME[provider as Provider];
    const feedId = await db.transaction(async (tx) => {
      await tx.select({ id: households.id }).from(households).where(eq(households.id, household.id)).for("update");
      // Connecting the same account again replaces its grant rather than adding a copy.
      const [same] = await tx.select().from(calendarFeeds).where(and(eq(calendarFeeds.accountId, actor.accountId), eq(calendarFeeds.provider, provider as Provider), eq(calendarFeeds.label, label)));
      if (same) {
        await tx.update(calendarFeeds).set({ credentials: seal(JSON.stringify(tokens)), lastError: null, version: sql`${calendarFeeds.version} + 1` }).where(eq(calendarFeeds.id, same.id));
        return same.id;
      }
      const [{ n }] = await tx.select({ n: count() }).from(calendarFeeds).where(eq(calendarFeeds.accountId, actor.accountId));
      if (n >= 5) return null;
      const [row] = await tx
        .insert(calendarFeeds)
        .values({ householdId: household.id, accountId: actor.accountId, label, url: "primary", provider: provider as Provider, credentials: seal(JSON.stringify(tokens)), visibility: "busy_only", writeBusy: true })
        .returning({ id: calendarFeeds.id });
      return row.id;
    });
    if (!feedId) return back("too_many");
    await syncFeed(db, feedId).catch(() => null);
    return back("connected");
  } catch {
    return back("failed");
  }
}
