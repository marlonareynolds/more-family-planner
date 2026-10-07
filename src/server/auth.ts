import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db/client";
import { accounts } from "@/db/schema";
import { DomainError } from "@/domain/errors";

/**
 * Identity boundary (spec 9.1, 16.3). Identity is always a verified
 * session: Supabase Auth in deployed environments, or a signed development
 * cookie locally. Request headers are never trusted as identity.
 */

export interface Actor {
  accountId: string;
  displayName: string;
}

export interface Identity {
  subject: string;
  displayName: string;
  /** Verified by the identity provider; only used for the weekly email. */
  email?: string;
  /** The provider confirmed the person controls this email (magic link or OTP). */
  emailVerified?: boolean;
}

export type AuthMode = "supabase" | "dev";

export function authMode(): AuthMode {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return "supabase";
  if (process.env.NODE_ENV === "production" && process.env.MORE_ALLOW_DEV_AUTH !== "1") {
    throw new Error("No identity provider configured. Set the Supabase environment variables.");
  }
  return "dev";
}

export const DEV_COOKIE = "more_dev_session";
const DEV_TTL_MS = 7 * 24 * 3_600_000;

function devSecret(): string {
  const s = process.env.MORE_SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("MORE_SESSION_SECRET is required");
  return "more-local-development-only";
}

function sign(data: string): string {
  return createHmac("sha256", devSecret()).update(data).digest("base64url");
}

export function signDevSession(identity: Identity, nowMs = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...identity, exp: nowMs + DEV_TTL_MS })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyDevSession(token: string | undefined, nowMs = Date.now()): Identity | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as Identity & { exp: number };
    if (typeof data.exp !== "number" || data.exp < nowMs) return null;
    if (typeof data.subject !== "string" || typeof data.displayName !== "string") return null;
    return { subject: data.subject, displayName: data.displayName };
  } catch {
    return null;
  }
}

/** Find or create the account for a verified identity. */
export async function accountFor(db: DbOrTx, identity: Identity): Promise<Actor> {
  const [existing] = await db.select().from(accounts).where(eq(accounts.identitySubject, identity.subject));
  if (existing) {
    if (existing.closedAt) throw new DomainError("UNAUTHENTICATED", "This account has been closed.");
    if (identity.email && identity.email !== existing.email) {
      await db.update(accounts).set({ email: identity.email }).where(eq(accounts.id, existing.id));
    }
    return { accountId: existing.id, displayName: existing.displayName };
  }
  const relinked = await relink(db, identity);
  if (relinked) return relinked;
  const [created] = await db
    .insert(accounts)
    .values({ identitySubject: identity.subject, displayName: identity.displayName.slice(0, 60) || "You", email: identity.email ?? null })
    .onConflictDoNothing({ target: accounts.identitySubject })
    .returning();
  if (created) return { accountId: created.id, displayName: created.displayName };
  const [raced] = await db.select().from(accounts).where(eq(accounts.identitySubject, identity.subject));
  return { accountId: raced.id, displayName: raced.displayName };
}

/**
 * After a restore onto a new sign-in service (docs/restore.md), accounts are
 * marked `relink:` and wait for their owner. The first sign-in with the same
 * verified email takes the account back, with its household and history.
 */
async function relink(db: DbOrTx, identity: Identity): Promise<Actor | null> {
  if (!identity.email || !identity.emailVerified) return null;
  const [claimed] = await db
    .update(accounts)
    .set({ identitySubject: identity.subject })
    .where(
      eq(
        accounts.id,
        sql`(select id from accounts where lower(email) = lower(${identity.email}) and identity_subject like 'relink:%' and closed_at is null
             order by created_at limit 1 for update skip locked)`,
      ),
    )
    .returning();
  return claimed ? { accountId: claimed.id, displayName: claimed.displayName } : null;
}

/** Read the verified identity for the current request, if any. */
export async function currentIdentity(): Promise<Identity | null> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  if (authMode() === "dev") return verifyDevSession(jar.get(DEV_COOKIE)?.value);

  const { createServerClient } = await import("@supabase/ssr");
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) jar.set(c.name, c.value, c.options);
        } catch {
          // Server components cannot set cookies; src/proxy.ts refreshes them.
        }
      },
    },
  });
  // getUser() re-validates the token with the auth server.
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const name = (data.user.user_metadata?.full_name as string | undefined) ?? data.user.email?.split("@")[0] ?? "You";
  return { subject: `supabase:${data.user.id}`, displayName: name, email: data.user.email ?? undefined, emailVerified: Boolean(data.user.email_confirmed_at) };
}

export async function currentActor(): Promise<Actor | null> {
  const identity = await currentIdentity();
  if (!identity) return null;
  return accountFor(await getDb(), identity);
}

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Please sign in again.");
  return actor;
}
