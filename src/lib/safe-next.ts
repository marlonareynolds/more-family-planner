/**
 * Where to go after signing in, kept inside More. Only a plain path is
 * allowed: "/" followed by a letter or digit, with no backslash, scheme,
 * double slash or control character, so a crafted link like "/\evil.com"
 * (which browsers read as https://evil.com) falls back to Today.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/today"): string {
  if (typeof next !== "string" || next.length > 500) return fallback;
  if (!/^\/[A-Za-z0-9]/.test(next)) return fallback;
  if (/[\\\s\u0000-\u001f\u007f]/.test(next) || next.includes("//") || /%(2f|5c|0[0-9a-f]|1[0-9a-f])/i.test(next)) return fallback;
  return next;
}
