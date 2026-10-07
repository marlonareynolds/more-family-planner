import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps Supabase sessions alive. Server components cannot write cookies, so
 * the rotated access and refresh tokens are saved here, before rendering.
 * Does nothing in development sign-in mode. Authorisation still happens in
 * each command and page; this only refreshes cookies.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();

  const { createServerClient } = await import("@supabase/ssr");
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|sw.js|manifest.webmanifest|api/v1/cron|api/v1/asks|api/v1/calendar|api/v1/display|ask/|display/).*)"],
};
