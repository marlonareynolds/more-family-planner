import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { careArrangements, expenses, moments, paymentTransactions } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { assertRefundAllowed, summarise } from "@/domain/money";
import { instantToLocalDate } from "@/domain/time";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { dateString, minor, requiredText } from "./helpers";

/**
 * One canonical expense per real cost, linked from every surface that shows
 * it, with payments and refunds as appended transactions (spec 8.9, INV-09).
 */

async function sourceDate(ctx: CommandContext, sourceType: "moment" | "care" | "other", sourceId: string | null, fallback?: string) {
  if (sourceType === "moment" && sourceId) {
    const [m] = await ctx.tx.select().from(moments).where(and(eq(moments.id, sourceId), eq(moments.householdId, ctx.household.id)));
    if (!m || (m.sharing === "private" && m.organiserId !== ctx.actor.accountId)) throw new DomainError("NOT_FOUND", "That plan could not be found.");
    return instantToLocalDate(m.startAt.getTime(), ctx.household.timeZone);
  }
  if (sourceType === "care" && sourceId) {
    const [c] = await ctx.tx.select().from(careArrangements).where(and(eq(careArrangements.id, sourceId), eq(careArrangements.householdId, ctx.household.id)));
    if (!c) throw new DomainError("NOT_FOUND", "That arrangement could not be found.");
    return instantToLocalDate(c.startAt.getTime(), ctx.household.timeZone);
  }
  if (!fallback) throw new DomainError("VALIDATION", "Choose the date this cost belongs to.");
  return fallback;
}

export const addExpense = defineCommand({
  name: "AddExpense",
  scope: "household",
  payload: z.object({
    label: requiredText(120, "A description"),
    estimateMinor: minor.nullable().default(null),
    committedMinor: minor.nullable().default(null),
    sourceType: z.enum(["moment", "care", "other"]).default("other"),
    sourceId: z.uuid().nullable().default(null),
    activityDate: dateString.optional(),
  }),
  async handler(ctx, p) {
    const activityDate = await sourceDate(ctx, p.sourceType, p.sourceId, p.activityDate);
    const [e] = await ctx.tx
      .insert(expenses)
      .values({
        householdId: ctx.household.id,
        label: p.label,
        estimateMinor: p.estimateMinor,
        committedMinor: p.committedMinor,
        sourceType: p.sourceType,
        sourceId: p.sourceId,
        activityDate,
        createdBy: ctx.actor.accountId,
      })
      .returning();
    await ctx.audit("expense.add", "expense", e.id);
    return { expenseId: e.id };
  },
});

export const updateExpense = defineCommand({
  name: "UpdateExpense",
  scope: "household",
  payload: z.object({
    expenseId: z.uuid(),
    version: z.number().int(),
    label: requiredText(120, "A description"),
    estimateMinor: minor.nullable(),
    committedMinor: minor.nullable(),
  }),
  async handler(ctx, p) {
    const [e] = await ctx.tx.select().from(expenses).where(and(eq(expenses.id, p.expenseId), eq(expenses.householdId, ctx.household.id)));
    assertVersion(e, p.version, "This cost");
    await ctx.tx
      .update(expenses)
      .set({ label: p.label, estimateMinor: p.estimateMinor, committedMinor: p.committedMinor, version: sql`${expenses.version} + 1` })
      .where(eq(expenses.id, e.id));
    return { expenseId: e.id };
  },
});

export const recordTransaction = defineCommand({
  name: "RecordTransaction",
  scope: "household",
  payload: z.object({
    expenseId: z.uuid(),
    kind: z.enum(["payment", "refund"]),
    amountMinor: minor.refine((n) => n > 0, "Enter an amount above zero."),
  }),
  async handler(ctx, p) {
    const [e] = await ctx.tx
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, p.expenseId), eq(expenses.householdId, ctx.household.id)))
      .for("update");
    if (!e) throw new DomainError("NOT_FOUND", "That cost could not be found.");
    if (p.kind === "refund") {
      const txs = await ctx.tx.select().from(paymentTransactions).where(eq(paymentTransactions.expenseId, e.id));
      assertRefundAllowed(summarise(e, txs), p.amountMinor);
    }
    // Replays are absorbed by the envelope's idempotency key (AT-23).
    const [t] = await ctx.tx
      .insert(paymentTransactions)
      .values({ expenseId: e.id, kind: p.kind, amountMinor: p.amountMinor, createdBy: ctx.actor.accountId })
      .returning();
    await ctx.audit(`expense.${p.kind}`, "expense", e.id);
    return { transactionId: t.id };
  },
});
