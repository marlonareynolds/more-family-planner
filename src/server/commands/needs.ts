import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { kindnessMarks, needNotes, partnerNeeds } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { isWeekKey } from "@/domain/time";
import { NEEDS, kindnessByKey } from "@/lib/kindness";
import { defineCommand } from "../pipeline";
import { seal } from "../secret-box";
import { currentAdults, dateString } from "./helpers";

/**
 * What would help (src/lib/kindness.ts). Account-owned like the journal:
 * nothing here touches the household's shared records, and no audit or
 * analytics line names a need. The household is only read to know who the
 * partner is.
 */

/** Ended needs are kept only while they can still count for a week (a week and a day), then erased. */
const KEEP_ENDED_MS = 8 * 86_400_000;

export const saveNeeds = defineCommand({
  name: "SaveNeeds",
  scope: "household",
  payload: z.object({
    needs: z
      .array(z.object({ need: z.enum(NEEDS), shapes: z.boolean().default(true) }))
      .max(NEEDS.length)
      .refine((list) => new Set(list.map((n) => n.need)).size === list.length, "Each one only once."),
    note: z.string().trim().max(500, "Keep it to a few lines.").default(""),
  }),
  async handler(ctx, p) {
    const me = ctx.actor.accountId;
    const others = (await currentAdults(ctx.tx, ctx.household.id)).filter((a) => a.id !== me);
    // About your partner; before anyone joins (or with several adults), about whoever you share the household with.
    const about = others.length === 1 ? others[0].id : null;
    const wanted = new Map(p.needs.map((n) => [n.need, n.shapes]));

    const open = await ctx.tx.select().from(partnerNeeds).where(and(eq(partnerNeeds.accountId, me), isNull(partnerNeeds.until)));
    const kept = new Set<string>();
    for (const row of open) {
      if (wanted.get(row.need as (typeof NEEDS)[number]) === row.shapes && row.aboutId === about) kept.add(row.need);
      else await ctx.tx.update(partnerNeeds).set({ until: ctx.now }).where(eq(partnerNeeds.id, row.id));
    }
    for (const [need, shapes] of wanted) {
      if (!kept.has(need)) await ctx.tx.insert(partnerNeeds).values({ accountId: me, aboutId: about, need, shapes, since: ctx.now });
    }
    await ctx.tx.delete(partnerNeeds).where(and(eq(partnerNeeds.accountId, me), lt(partnerNeeds.until, new Date(ctx.now.getTime() - KEEP_ENDED_MS))));

    if (p.note) {
      const sealed = seal(p.note, "need-notes");
      await ctx.tx.insert(needNotes).values({ accountId: me, sealed, updatedAt: ctx.now }).onConflictDoUpdate({ target: needNotes.accountId, set: { sealed, updatedAt: ctx.now } });
    } else {
      await ctx.tx.delete(needNotes).where(eq(needNotes.accountId, me));
    }
    return { saved: true };
  },
});

export const markKindness = defineCommand({
  name: "MarkKindness",
  scope: "household",
  payload: z.object({
    weekKey: dateString.refine(isWeekKey, "A week starts on a Monday."),
    key: z.string().min(1).max(64),
    mark: z.enum(["done", "skip"]).nullable(),
  }),
  async handler(ctx, p) {
    if (!kindnessByKey(p.key)) throw new DomainError("VALIDATION", "That suggestion isn't one of More's.");
    const me = ctx.actor.accountId;
    const where = and(eq(kindnessMarks.accountId, me), eq(kindnessMarks.weekKey, p.weekKey), eq(kindnessMarks.kindnessKey, p.key));
    if (p.mark === null) {
      await ctx.tx.delete(kindnessMarks).where(where);
      return { cleared: true };
    }
    await ctx.tx
      .insert(kindnessMarks)
      .values({ accountId: me, weekKey: p.weekKey, kindnessKey: p.key, mark: p.mark })
      .onConflictDoUpdate({ target: [kindnessMarks.accountId, kindnessMarks.weekKey, kindnessMarks.kindnessKey], set: { mark: p.mark } });
    return { marked: p.mark };
  },
});

/** Scheduled clean-up: ended needs past the week they could count for, and old kindness marks. */
export async function purgeNeeds(db: DbOrTx, now = new Date()) {
  const ended = await db.delete(partnerNeeds).where(lt(partnerNeeds.until, new Date(now.getTime() - KEEP_ENDED_MS))).returning({ id: partnerNeeds.id });
  const cutoff = new Date(now.getTime() - 70 * 86_400_000).toISOString().slice(0, 10);
  const marks = await db.delete(kindnessMarks).where(lt(kindnessMarks.weekKey, cutoff)).returning({ k: kindnessMarks.kindnessKey });
  return { ended: ended.length, marks: marks.length };
}
