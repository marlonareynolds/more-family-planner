import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, households, invitations } from "@/db/schema";
import { hashInviteToken } from "../commands/household";

export type InviteState = "open" | "expired" | "used" | "cancelled" | "unknown";

export interface InvitePreview {
  state: InviteState;
  /** Who made the link and for which household; only for a link that was really made. */
  inviterName: string | null;
  householdName: string | null;
}

/**
 * What a join link says before anyone signs in (review: "the join page
 * doesn't say who invited you; a dead link looks valid until tapped").
 * Holding the link is what an invitation is, so the inviter's first name and
 * the household's name are shown to whoever has it; nothing else is.
 */
export async function previewInvite(db: Db, token: string, now = new Date()): Promise<InvitePreview> {
  if (token.length < 10 || token.length > 200) return { state: "unknown", inviterName: null, householdName: null };
  const [row] = await db
    .select({ inv: invitations, inviterName: accounts.displayName, householdName: households.name, deletedAt: households.deletedAt })
    .from(invitations)
    .innerJoin(accounts, eq(accounts.id, invitations.createdBy))
    .innerJoin(households, eq(households.id, invitations.householdId))
    .where(eq(invitations.tokenHash, hashInviteToken(token)));
  if (!row || row.deletedAt) return { state: "unknown", inviterName: null, householdName: null };
  const state: InviteState = row.inv.acceptedAt ? "used" : row.inv.revokedAt ? "cancelled" : row.inv.expiresAt.getTime() <= now.getTime() ? "expired" : "open";
  return { state, inviterName: row.inviterName, householdName: row.householdName };
}
