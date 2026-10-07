import { cookies } from "next/headers";
import { z } from "zod";
import { authMode, DEV_COOKIE, signDevSession } from "@/server/auth";
import { assertSameOrigin, errorResponse } from "@/server/http";
import { DomainError } from "@/domain/errors";

/**
 * Local development sign-in with synthetic people. Disabled whenever a real
 * identity provider is configured.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    if (authMode() !== "dev") throw new DomainError("NOT_FOUND", "Not available.");
    const { name } = z.object({ name: z.string().trim().min(1).max(40) }).parse(await req.json());
    const subject = `dev:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const jar = await cookies();
    jar.set(DEV_COOKIE, signDevSession({ subject, displayName: name }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
