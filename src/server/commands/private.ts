import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { checkins, feedback, journalEntries, notifications, preferences, suppressions } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { isWeekKey } from "@/domain/time";
import { defineCommand, assertVersion, type AccountContext } from "../pipeline";
import { dateString, shortText } from "./helpers";

/**
 * Account-owned private records (spec 8.2, 8.3, 8.10, INV-01). These
 * commands are account-scoped: no household, partner or payer can reach
 * them, and they survive leaving or deleting a household.
 */

const tag = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9 -]{0,23}$/, "Tags use letters, numbers and dashes.");

/** The entry, row-locked for the rest of this transaction; owner-scoped. */
async function lockedEntry(ctx: AccountContext, entryId: string) {
  const [row] = await ctx.tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.accountId, ctx.actor.accountId), isNull(journalEntries.deletedAt)))
    .for("update");
  return row;
}

const staleEntry = () => new DomainError("STALE_VERSION", "This entry changed since you opened it. Your text is still here: copy it, then refresh.");

export const saveJournalEntry = defineCommand({
  name: "SaveJournalEntry",
  scope: "account",
  payload: z.object({
    entryId: z.uuid().optional(),
    version: z.number().int().optional(),
    entryDate: dateString,
    title: shortText(120).default(""),
    body: z.string().trim().min(1, "Write something first.").max(20_000),
    tags: z.array(tag).max(10).default([]),
  }),
  async handler(ctx, p) {
    if (!p.entryId) {
      const [e] = await ctx.tx
        .insert(journalEntries)
        .values({ accountId: ctx.actor.accountId, entryDate: p.entryDate, title: p.title, body: p.body, tags: [...new Set(p.tags)] })
        .returning();
      return { entryId: e.id, version: e.version };
    }
    const row = await lockedEntry(ctx, p.entryId);
    assertVersion(row, p.version, "This entry");
    // Compare-and-set: the write itself carries the expected version, so two
    // saves from one version can never both land (BR-02).
    const [e] = await ctx.tx
      .update(journalEntries)
      .set({ entryDate: p.entryDate, title: p.title, body: p.body, tags: [...new Set(p.tags)], updatedAt: ctx.now, version: sql`${journalEntries.version} + 1` })
      .where(and(eq(journalEntries.id, row.id), eq(journalEntries.accountId, ctx.actor.accountId), eq(journalEntries.version, p.version!), isNull(journalEntries.deletedAt)))
      .returning();
    if (!e) throw staleEntry();
    return { entryId: e.id, version: e.version };
  },
});

export const deleteJournalEntry = defineCommand({
  name: "DeleteJournalEntry",
  scope: "account",
  payload: z.object({ entryId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const row = await lockedEntry(ctx, p.entryId);
    assertVersion(row, p.version, "This entry");
    // Body is cleared immediately; the tombstone allows undo of the listing only.
    // Deleting needs the version you saw, so a newer save is never wiped unseen (BR-03).
    const done = await ctx.tx
      .update(journalEntries)
      .set({ deletedAt: ctx.now, body: "", title: "", tags: [], version: sql`${journalEntries.version} + 1` })
      .where(and(eq(journalEntries.id, row.id), eq(journalEntries.accountId, ctx.actor.accountId), eq(journalEntries.version, p.version), isNull(journalEntries.deletedAt)))
      .returning({ id: journalEntries.id });
    if (!done.length) throw staleEntry();
    return { deleted: true };
  },
});

const scale = z.number().int().min(1).max(5).nullable().default(null);

/**
 * One check-in per adult per week, last write wins by decision: it is a
 * two-question form only its author edits, so there is no expected version.
 */
export const saveCheckin = defineCommand({
  name: "SaveCheckin",
  scope: "account",
  payload: z.object({
    weekKey: dateString.refine(isWeekKey, "A week starts on a Monday."),
    energy: scale,
    pressure: scale,
    wants: z.array(z.enum(["quiet", "exercise", "friends", "creativity", "sleep", "outdoors", "couple time", "family time"])).max(8).default([]),
    note: shortText(1000).default(""),
  }),
  async handler(ctx, p) {
    const values = { energy: p.energy, pressure: p.pressure, wants: p.wants, note: p.note };
    const [row] = await ctx.tx
      .insert(checkins)
      .values({ accountId: ctx.actor.accountId, weekKey: p.weekKey, ...values })
      .onConflictDoUpdate({ target: [checkins.accountId, checkins.weekKey], set: { ...values, version: sql`${checkins.version} + 1` } })
      .returning();
    return { checkinId: row.id };
  },
});

export const setPreference = defineCommand({
  name: "SetPreference",
  scope: "account",
  payload: z.object({ activityKey: z.string().min(1).max(80), guidance: z.enum(["allow", "avoid", "simplify"]).nullable() }),
  async handler(ctx, p) {
    if (p.guidance === null) {
      await ctx.tx.delete(preferences).where(and(eq(preferences.accountId, ctx.actor.accountId), eq(preferences.activityKey, p.activityKey)));
      return { cleared: true };
    }
    await ctx.tx
      .insert(preferences)
      .values({ accountId: ctx.actor.accountId, activityKey: p.activityKey, guidance: p.guidance })
      .onConflictDoUpdate({ target: [preferences.accountId, preferences.activityKey], set: { guidance: p.guidance, updatedAt: ctx.now } });
    return { saved: true };
  },
});

/** Forget what More inferred about an activity; durable until restored (AT-16). */
export const forgetInference = defineCommand({
  name: "ForgetInference",
  scope: "account",
  payload: z.object({ activityKey: z.string().min(1).max(80), restore: z.boolean().default(false) }),
  async handler(ctx, p) {
    if (p.restore) {
      await ctx.tx.delete(suppressions).where(and(eq(suppressions.accountId, ctx.actor.accountId), eq(suppressions.activityKey, p.activityKey)));
      return { restored: true };
    }
    const evidence = await ctx.tx
      .select({ id: feedback.id })
      .from(feedback)
      .where(and(eq(feedback.accountId, ctx.actor.accountId), eq(feedback.activityKey, p.activityKey)));
    await ctx.tx
      .insert(suppressions)
      .values({ accountId: ctx.actor.accountId, activityKey: p.activityKey, evidenceIds: evidence.map((e) => e.id) })
      .onConflictDoUpdate({ target: [suppressions.accountId, suppressions.activityKey], set: { evidenceIds: evidence.map((e) => e.id) } });
    return { forgotten: true };
  },
});

export const markNotificationsRead = defineCommand({
  name: "MarkNotificationsRead",
  scope: "account",
  payload: z.object({ ids: z.array(z.uuid()).max(100) }),
  async handler(ctx, p) {
    if (!p.ids.length) throw new DomainError("VALIDATION", "Nothing to mark.");
    for (const id of p.ids) {
      await ctx.tx
        .update(notifications)
        .set({ readAt: ctx.now })
        .where(and(eq(notifications.id, id), eq(notifications.accountId, ctx.actor.accountId), isNull(notifications.readAt)));
    }
    return { marked: p.ids.length };
  },
});
