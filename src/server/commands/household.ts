import { createHash, randomBytes } from "node:crypto";
import { and, arrayContains, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  accounts,
  auditEvents,
  calendarFeeds,
  careArrangements,
  childWishes,
  children,
  displayLinks,
  events,
  households,
  invitations,
  memberships,
  moments,
  preparationTasks,
  rituals,
} from "@/db/schema";
import type { Tx } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { isValidTimeZone } from "@/domain/time";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { currentAdults, release, requiredText, shortText, supersedeDeliveries } from "./helpers";
import { clearForecast } from "../weather";
import { disconnectFeed } from "./calendars";
import { endRitualRow } from "./rituals";
import { releaseJobsOf } from "./jobs";

/** The supported household shape for this release (spec 3.2, D-02). */
export const MAX_ADULTS = 2;
const INVITE_TTL_MS = 7 * 86_400_000;

const timeZone = z.string().refine(isValidTimeZone, "Choose a valid timezone.");

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function activeMembership(tx: Tx, accountId: string) {
  const [m] = await tx.select().from(memberships).where(and(eq(memberships.accountId, accountId), isNull(memberships.endsAt)));
  return m;
}

export const createHousehold = defineCommand({
  name: "CreateHousehold",
  scope: "account",
  payload: z.object({ name: requiredText(60, "A household name"), timeZone: timeZone.default("Europe/London") }),
  async handler(ctx, p) {
    if (await activeMembership(ctx.tx, ctx.actor.accountId)) {
      throw new DomainError("CONFLICT", "You are already in a household. Leave it before starting another.");
    }
    const [h] = await ctx.tx.insert(households).values({ name: p.name, timeZone: p.timeZone }).returning();
    await ctx.tx.insert(memberships).values({ householdId: h.id, accountId: ctx.actor.accountId });
    await ctx.tx.insert(auditEvents).values({ householdId: h.id, actorId: ctx.actor.accountId, action: "household.create", resourceType: "household", resourceId: h.id, result: "ok" });
    await ctx.track("household_created", null, h.id);
    return { householdId: h.id };
  },
});

export const updateHousehold = defineCommand({
  name: "UpdateHousehold",
  scope: "household",
  payload: z.object({ version: z.number().int(), name: requiredText(60, "A household name"), timeZone }),
  async handler(ctx, p) {
    assertVersion(ctx.household, p.version, "The household");
    await ctx.tx
      .update(households)
      .set({ name: p.name, timeZone: p.timeZone, version: sql`${households.version} + 1` })
      .where(eq(households.id, ctx.household.id));
    if (p.timeZone !== ctx.household.timeZone) await ctx.bumpSchedule();
    await ctx.audit("household.update", "household", ctx.household.id);
    return { householdId: ctx.household.id };
  },
});

/**
 * The household's town, for the forecast and "near you" links. Only a place
 * name and rounded coordinates are kept; clearing it forgets the forecast.
 */
export const setHouseholdLocation = defineCommand({
  name: "SetHouseholdLocation",
  scope: "household",
  payload: z.object({
    placeName: shortText(80).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
  }),
  async handler(ctx, p) {
    const set = p.placeName && p.latitude !== null && p.longitude !== null;
    const round = (n: number) => Math.round(n * 100) / 100;
    await ctx.tx
      .update(households)
      .set(set ? { placeName: p.placeName, latitude: round(p.latitude!), longitude: round(p.longitude!), version: sql`${households.version} + 1` } : { placeName: null, latitude: null, longitude: null, version: sql`${households.version} + 1` })
      .where(eq(households.id, ctx.household.id));
    await clearForecast(ctx.tx, ctx.household.id);
    await ctx.audit("household.location", "household", ctx.household.id);
    return { placeName: set ? p.placeName : null };
  },
});

export const createInvite = defineCommand({
  name: "CreateInvite",
  scope: "household",
  payload: z.object({}),
  async handler(ctx) {
    const adults = await currentAdults(ctx.tx, ctx.household.id);
    if (adults.length >= MAX_ADULTS) throw new DomainError("CONFLICT", "This household already has two adults.");
    // One live invitation at a time: older links stop working.
    await ctx.tx
      .update(invitations)
      .set({ revokedAt: ctx.now })
      .where(and(eq(invitations.householdId, ctx.household.id), isNull(invitations.revokedAt), isNull(invitations.acceptedAt)));
    const token = randomBytes(24).toString("base64url");
    const [inv] = await ctx.tx
      .insert(invitations)
      .values({
        householdId: ctx.household.id,
        tokenHash: hashInviteToken(token),
        createdBy: ctx.actor.accountId,
        expiresAt: new Date(ctx.now.getTime() + INVITE_TTL_MS),
      })
      .returning();
    await ctx.audit("invite.create", "invitation", inv.id);
    // The token is only ever returned once; only its hash is stored.
    return { invitationId: inv.id, token, expiresAt: inv.expiresAt.toISOString() };
  },
});

export const revokeInvite = defineCommand({
  name: "RevokeInvite",
  scope: "household",
  payload: z.object({ invitationId: z.uuid() }),
  async handler(ctx, p) {
    const rows = await ctx.tx
      .update(invitations)
      .set({ revokedAt: ctx.now })
      .where(and(eq(invitations.id, p.invitationId), eq(invitations.householdId, ctx.household.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning({ id: invitations.id });
    if (!rows.length) throw new DomainError("NOT_FOUND", "That invitation is no longer open.");
    await ctx.audit("invite.revoke", "invitation", p.invitationId);
    return { revoked: true };
  },
});

export const joinHousehold = defineCommand({
  name: "JoinHousehold",
  scope: "account",
  payload: z.object({ token: z.string().min(10).max(200) }),
  async handler(ctx, p) {
    const invalid = () => new DomainError("INVITE_INVALID", "This invitation link is no longer valid. Ask for a new one.");
    // Lock the household, then the invitation: the same order as household
    // commands such as RevokeInvite, so a revoke and a join at the same moment
    // queue behind each other instead of deadlocking (BR-17). Only one can win (AT-01).
    const [found] = await ctx.tx.select({ householdId: invitations.householdId }).from(invitations).where(eq(invitations.tokenHash, hashInviteToken(p.token)));
    if (!found) throw invalid();
    const [h] = await ctx.tx
      .select()
      .from(households)
      .where(and(eq(households.id, found.householdId), isNull(households.deletedAt)))
      .for("update");
    if (!h) throw invalid();
    const [inv] = await ctx.tx.select().from(invitations).where(eq(invitations.tokenHash, hashInviteToken(p.token))).for("update");
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt.getTime() <= ctx.now.getTime()) throw invalid();
    if (await activeMembership(ctx.tx, ctx.actor.accountId)) {
      throw new DomainError("CONFLICT", "You are already in a household. Leave it before joining another.");
    }
    const adults = await currentAdults(ctx.tx, h.id);
    if (adults.length >= MAX_ADULTS) throw invalid();

    await ctx.tx.insert(memberships).values({ householdId: h.id, accountId: ctx.actor.accountId });
    await ctx.tx.update(invitations).set({ acceptedBy: ctx.actor.accountId, acceptedAt: ctx.now }).where(eq(invitations.id, inv.id));
    await ctx.tx
      .update(households)
      .set({ membershipRevision: sql`${households.membershipRevision} + 1` })
      .where(eq(households.id, h.id));
    // A new partner never inherits old consent (AT-03): acceptance rows are
    // per person and per version, so nothing is carried over.
    await ctx.track("partner_joined", null, h.id);
    return { householdId: h.id };
  },
});

/**
 * Remove an adult's future assumptions from the household: their personal
 * diary leaves with them, plans they organised are cancelled, plans they
 * were part of reopen for review, and care they promised becomes unresolved.
 * Completed history stays as it was (spec 8.1, 14.4).
 */
async function detachAdult(ctx: CommandContext, accountId: string, reason: string): Promise<void> {
  const { tx, household, now } = ctx;

  // Rituals they're part of stop: nobody else agreed to carry them alone.
  const theirs = await tx
    .select({ id: rituals.id })
    .from(rituals)
    .where(and(eq(rituals.householdId, household.id), isNull(rituals.endedAt), arrayContains(rituals.participantIds, [accountId])));
  for (const r of theirs) await endRitualRow(ctx, r.id);
  // Their household jobs go back to the shared list.
  await releaseJobsOf(ctx, accountId);

  // Calendar links go with the adult: their imported copies leave too.
  const feeds = await tx.select({ id: calendarFeeds.id }).from(calendarFeeds).where(and(eq(calendarFeeds.householdId, household.id), eq(calendarFeeds.accountId, accountId)));
  for (const f of feeds) await disconnectFeed(ctx, f.id);

  await tx
    .update(events)
    .set({ cancelledAt: now, version: sql`${events.version} + 1` })
    .where(and(eq(events.householdId, household.id), eq(events.ownerId, accountId), isNull(events.cancelledAt), or(gt(events.endAt, now), sql`${events.rule} is not null`)));

  const affected = await tx
    .select()
    .from(moments)
    .where(
      and(
        eq(moments.householdId, household.id),
        gt(moments.endAt, now),
        or(eq(moments.lifecycle, "draft"), eq(moments.lifecycle, "planned")),
        or(eq(moments.organiserId, accountId), arrayContains(moments.participantIds, [accountId])),
      ),
    );
  for (const m of affected) {
    await release(tx, "moment", m.id);
    await supersedeDeliveries(tx, m.id);
    if (m.organiserId === accountId) {
      await tx
        .update(moments)
        .set({ lifecycle: "cancelled", review: "needs_review", reviewReason: reason, version: sql`${moments.version} + 1` })
        .where(eq(moments.id, m.id));
    } else {
      await tx
        .update(moments)
        .set({
          participantIds: m.participantIds.filter((id) => id !== accountId),
          materialVersion: sql`${moments.materialVersion} + 1`,
          review: "needs_review",
          reviewReason: reason,
          version: sql`${moments.version} + 1`,
        })
        .where(eq(moments.id, m.id));
    }
  }
  await tx
    .update(preparationTasks)
    .set({ ownerId: sql`(select organiser_id from moments where moments.id = ${preparationTasks.momentId})`, state: "open", version: sql`${preparationTasks.version} + 1` })
    .where(and(eq(preparationTasks.householdId, household.id), eq(preparationTasks.ownerId, accountId), eq(preparationTasks.state, "open")));

  const promised = await tx
    .select({ id: careArrangements.id })
    .from(careArrangements)
    .where(and(eq(careArrangements.householdId, household.id), eq(careArrangements.responsibleAccountId, accountId), gt(careArrangements.endAt, now), ne(careArrangements.state, "declined")));
  for (const c of promised) {
    await release(tx, "care", c.id);
    await tx.update(careArrangements).set({ state: "declined", note: reason, version: sql`${careArrangements.version} + 1` }).where(eq(careArrangements.id, c.id));
  }
  // Drop-offs and collections they were down for are open again.
  for (const leg of ["drop_off", "collect"] as const) {
    const col = leg === "drop_off" ? careArrangements.dropOffBy : careArrangements.collectBy;
    const named = await tx.select({ id: careArrangements.id }).from(careArrangements).where(and(eq(careArrangements.householdId, household.id), eq(col, accountId), gt(careArrangements.endAt, now)));
    for (const c of named) {
      await release(tx, leg, c.id, [accountId]);
      await tx
        .update(careArrangements)
        .set({ ...(leg === "drop_off" ? { dropOffBy: null, dropOffAgreed: false } : { collectBy: null, collectAgreed: false }), version: sql`${careArrangements.version} + 1` })
        .where(eq(careArrangements.id, c.id));
    }
  }
  await tx
    .update(invitations)
    .set({ revokedAt: now })
    .where(and(eq(invitations.householdId, household.id), eq(invitations.createdBy, accountId), isNull(invitations.revokedAt), isNull(invitations.acceptedAt)));
  await ctx.bumpSchedule();
}

export const leaveHousehold = defineCommand({
  name: "LeaveHousehold",
  scope: "household",
  payload: z.object({ confirm: z.literal(true) }),
  async handler(ctx) {
    await detachAdult(ctx, ctx.actor.accountId, "A household member left");
    await ctx.tx
      .update(memberships)
      .set({ endsAt: ctx.now })
      .where(and(eq(memberships.householdId, ctx.household.id), eq(memberships.accountId, ctx.actor.accountId), isNull(memberships.endsAt)));
    await ctx.bumpMembership();
    const remaining = await currentAdults(ctx.tx, ctx.household.id);
    if (!remaining.length) await ctx.tx.update(households).set({ deletedAt: ctx.now }).where(eq(households.id, ctx.household.id));
    await ctx.audit("household.leave", "household", ctx.household.id);
    return { left: true };
  },
});

export const deleteHousehold = defineCommand({
  name: "DeleteHousehold",
  scope: "household",
  payload: z.object({ confirmName: z.string() }),
  async handler(ctx, p) {
    if (p.confirmName.trim() !== ctx.household.name) throw new DomainError("VALIDATION", "Type the household name exactly to confirm.");
    const adults = await currentAdults(ctx.tx, ctx.household.id);
    for (const a of adults) await detachAdult(ctx, a.id, "The household was deleted");
    await ctx.tx.update(memberships).set({ endsAt: ctx.now }).where(and(eq(memberships.householdId, ctx.household.id), isNull(memberships.endsAt)));
    await ctx.tx.update(households).set({ deletedAt: ctx.now }).where(eq(households.id, ctx.household.id));
    await ctx.bumpMembership();
    await ctx.audit("household.delete", "household", ctx.household.id);
    // Journals and other private records are account-owned and untouched (AT-14).
    return { deleted: true };
  },
});

const childFields = z.object({
  preferredName: requiredText(40, "A name"),
  ageBand: z.enum(["0-4", "5-7", "8-11", "12-15", "16+"]),
  needs: z.string().trim().max(500).default(""),
});

export const addChild = defineCommand({
  name: "AddChild",
  scope: "household",
  payload: childFields,
  async handler(ctx, p) {
    const count = await ctx.tx.$count(children, and(eq(children.householdId, ctx.household.id), isNull(children.archivedAt)));
    if (count >= 8) throw new DomainError("VALIDATION", "Up to eight children are supported for now.");
    const [c] = await ctx.tx.insert(children).values({ householdId: ctx.household.id, ...p }).returning();
    // A new child changes care for every future plan that needs it (AT-04):
    // keep the intention, mark it for review.
    await ctx.tx
      .update(moments)
      .set({ review: "needs_review", reviewReason: "Care needs checking for a new child", version: sql`${moments.version} + 1` })
      .where(and(eq(moments.householdId, ctx.household.id), eq(moments.needsCare, true), gt(moments.endAt, ctx.now), or(eq(moments.lifecycle, "draft"), eq(moments.lifecycle, "planned"))));
    await ctx.bumpSchedule();
    await ctx.audit("child.add", "child", c.id);
    return { childId: c.id };
  },
});

export const updateChild = defineCommand({
  name: "UpdateChild",
  scope: "household",
  payload: childFields.extend({ childId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const [row] = await ctx.tx.select().from(children).where(and(eq(children.id, p.childId), eq(children.householdId, ctx.household.id)));
    assertVersion(row, p.version, "This child's details");
    const { childId, ...rest } = p;
    const fields = { preferredName: rest.preferredName, ageBand: rest.ageBand, needs: rest.needs };
    await ctx.tx.update(children).set({ ...fields, version: sql`${children.version} + 1` }).where(eq(children.id, childId));
    return { childId };
  },
});

export const archiveChild = defineCommand({
  name: "ArchiveChild",
  scope: "household",
  payload: z.object({ childId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const [row] = await ctx.tx.select().from(children).where(and(eq(children.id, p.childId), eq(children.householdId, ctx.household.id)));
    assertVersion(row, p.version, "This child's details");
    await ctx.tx.update(children).set({ archivedAt: ctx.now, version: sql`${children.version} + 1` }).where(eq(children.id, p.childId));
    // Their own screen stops working, and any pick they left is put aside.
    await ctx.tx.update(displayLinks).set({ revokedAt: ctx.now }).where(and(eq(displayLinks.childId, p.childId), isNull(displayLinks.revokedAt)));
    await ctx.tx.update(childWishes).set({ handledAt: ctx.now }).where(and(eq(childWishes.childId, p.childId), isNull(childWishes.handledAt)));
    await ctx.bumpSchedule();
    return { childId: p.childId };
  },
});

export const updateProfile = defineCommand({
  name: "UpdateProfile",
  scope: "account",
  payload: z.object({ displayName: requiredText(40, "Your name"), timeZone }),
  async handler(ctx, p) {
    await ctx.tx
      .update(accounts)
      .set({ displayName: p.displayName, timeZone: p.timeZone, version: sql`${accounts.version} + 1` })
      .where(eq(accounts.id, ctx.actor.accountId));
    return { accountId: ctx.actor.accountId };
  },
});
