import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/** Supabase magic-link and OAuth return here to exchange the code for a session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/today";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/today";
  if (code && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const { createServerClient } = await import("@supabase/ssr");
    const jar = await cookies();
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => jar.getAll(), setAll: (list) => list.forEach((c) => jar.set(c.name, c.value, c.options)) },
    });
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
