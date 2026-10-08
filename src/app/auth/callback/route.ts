import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/safe-next";

/** Supabase magic-link and OAuth return here to exchange the code for a session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const safeNext = safeNextPath(url.searchParams.get("next"));
  if (code && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const { createServerClient } = await import("@supabase/ssr");
    const jar = await cookies();
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => jar.getAll(), setAll: (list) => list.forEach((c) => jar.set(c.name, c.value, c.options)) },
    });
    await supabase.auth.exchangeCodeForSession(code);
  }
  const target = new URL(safeNext, url.origin);
  // Belt and braces: never leave More's own site after signing in.
  return NextResponse.redirect(target.origin === url.origin ? target : new URL("/today", url.origin));
}
