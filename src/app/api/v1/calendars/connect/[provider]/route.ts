import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireActor } from "@/server/auth";
import { PROVIDERS, authorizeUrl, providerReady, type Provider } from "@/server/calendar-providers";
import { errorResponse } from "@/server/http";
import { signValue } from "@/server/secret-box";

const STATE_COOKIE = "more_calendar_state";

/** Start connecting Google Calendar or Outlook: off to the provider's consent screen. */
export async function GET(req: Request, { params }: RouteContext<"/api/v1/calendars/connect/[provider]">) {
  try {
    const actor = await requireActor();
    const { provider } = await params;
    if (!PROVIDERS.includes(provider as Provider) || !providerReady(provider as Provider)) {
      return NextResponse.redirect(new URL("/settings?calendar=unavailable#calendars", req.url));
    }
    const nonce = randomBytes(16).toString("base64url");
    const state = signValue(`${actor.accountId}.${provider}.${Date.now() + 10 * 60_000}.${nonce}`, "calendar-oauth");
    const jar = await cookies();
    jar.set(STATE_COOKIE, nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/v1/calendars", maxAge: 600 });
    return NextResponse.redirect(authorizeUrl(provider as Provider, state));
  } catch (err) {
    return errorResponse(err);
  }
}
