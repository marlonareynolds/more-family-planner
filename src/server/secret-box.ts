import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Sealing for secrets More must keep, such as a connected calendar's OAuth
 * tokens: AES-256-GCM with a key derived from MORE_SESSION_SECRET, so a
 * database copy alone can't use them.
 */

function root(): string {
  const s = process.env.MORE_SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("MORE_SESSION_SECRET is required");
  return "more-dev-only-secret";
}

const keyFor = (purpose: string) => Buffer.from(hkdfSync("sha256", root(), "more", purpose, 32));

export function seal(plain: string, purpose = "calendar-tokens"): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function unseal(sealed: string, purpose = "calendar-tokens"): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised sealed value");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(purpose), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** A short-lived signed value, e.g. OAuth state. */
export function signValue(value: string, purpose: string): string {
  return `${value}.${createHmac("sha256", keyFor(purpose)).update(value).digest("base64url")}`;
}

export function verifySigned(signed: string, purpose: string): string | null {
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const expected = Buffer.from(signValue(value, purpose).slice(i + 1));
  const given = Buffer.from(signed.slice(i + 1));
  return expected.length === given.length && timingSafeEqual(expected, given) ? value : null;
}

/**
 * A seed nobody can recompute from outside the server: used where an order
 * must not reveal what shaped it (small kindnesses, the date night menu).
 */
export function privateSeed(value: string): string {
  return createHmac("sha256", keyFor("private-seed")).update(value).digest("base64url");
}
