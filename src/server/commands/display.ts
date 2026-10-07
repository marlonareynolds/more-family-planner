import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { childWishes, displayLinks } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { defineCommand } from "../pipeline";
import { assertPeople } from "./helpers";

/**
 * Screens for the family (blueprint: kitchen display, a child's view). A link
 * opens a read-only screen with no account; it shows family logistics only.
 * The token is shown once and only its hash is kept.
 */

export const hashDisplayToken = (t: string) => createHash("sha256").update(t).digest("hex");
const MAX_LINKS = 8;

export const createDisplayLink = defineCommand({
  name: "CreateDisplayLink",
  scope: "household",
  payload: z.object({ childId: z.uuid().nullable().default(null) }),
  async handler(ctx, p) {
    if (p.childId) await assertPeople(ctx, [], [p.childId]);
    const live = await ctx.tx.select({ id: displayLinks.id }).from(displayLinks).where(and(eq(displayLinks.householdId, ctx.household.id), isNull(displayLinks.revokedAt)));
    if (live.length >= MAX_LINKS) throw new DomainError("VALIDATION", `Up to ${MAX_LINKS} screens can be linked. Switch one off first.`);
    const token = randomBytes(24).toString("base64url");
    const [row] = await ctx.tx
      .insert(displayLinks)
      .values({ householdId: ctx.household.id, childId: p.childId, tokenHash: hashDisplayToken(token), createdBy: ctx.actor.accountId })
      .returning({ id: displayLinks.id });
    await ctx.audit("display.create", "display_link", row.id);
    await ctx.track("display_linked", p.childId ? "child" : "kitchen");
    return { linkId: row.id, token };
  },
});

export const revokeDisplayLink = defineCommand({
  name: "RevokeDisplayLink",
  scope: "household",
  payload: z.object({ linkId: z.uuid() }),
  async handler(ctx, p) {
    const [row] = await ctx.tx
      .update(displayLinks)
      .set({ revokedAt: ctx.now })
      .where(and(eq(displayLinks.id, p.linkId), eq(displayLinks.householdId, ctx.household.id), isNull(displayLinks.revokedAt)))
      .returning({ id: displayLinks.id });
    if (!row) throw new DomainError("NOT_FOUND", "That screen link could not be found.");
    await ctx.audit("display.revoke", "display_link", row.id);
    return { revoked: true };
  },
});

/** "Not this time": put a child's wish aside without planning it. */
export const setWishAside = defineCommand({
  name: "SetWishAside",
  scope: "household",
  payload: z.object({ wishId: z.uuid() }),
  async handler(ctx, p) {
    const [row] = await ctx.tx
      .update(childWishes)
      .set({ handledAt: ctx.now })
      .where(and(eq(childWishes.id, p.wishId), eq(childWishes.householdId, ctx.household.id), isNull(childWishes.handledAt)))
      .returning({ id: childWishes.id });
    if (!row) throw new DomainError("NOT_FOUND", "That pick has already been dealt with.");
    return { handled: true };
  },
});
