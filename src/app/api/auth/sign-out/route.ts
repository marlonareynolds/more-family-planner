import { cookies } from "next/headers";
import { authMode, DEV_COOKIE } from "@/server/auth";

export async function POST() {
  const jar = await cookies();
  if (authMode() === "dev") {
    jar.delete(DEV_COOKIE);
  } else {
    const { createServerClient } = await import("@supabase/ssr");
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => jar.getAll(), setAll: (list) => list.forEach((c) => jar.set(c.name, c.value, c.options)) },
    });
    await supabase.auth.signOut();
  }
  return Response.json({ ok: true }, { headers: { "Clear-Site-Data": '"storage"' } });
}
