import type { NextConfig } from "next";

/**
 * What a page may load. Everything is first-party except Supabase sign-in,
 * Open-Meteo's town search and Vercel's preview toolbar. Scripts stay
 * 'unsafe-inline' because Next.js inlines its boot script; the rest still
 * blocks third-party code, framing, plugins and stray form posts.
 */
function contentSecurityPolicy(): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ws = supabase.replace(/^http/, "ws");
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://vercel.live`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://vercel.live https://vercel.com",
    "font-src 'self' data: https://vercel.live",
    `connect-src 'self' ${supabase} ${ws} https://geocoding-api.open-meteo.com https://vercel.live wss://ws-us3.pusher.com`.replace(/\s+/g, " "),
    "frame-src https://vercel.live",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  // PGlite loads its WASM and extension bundles from its own package
  // directory, so it must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // The embedded database applies migrations at start-up (demo deployments).
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        ],
      },
    ];
  },
};

export default nextConfig;
