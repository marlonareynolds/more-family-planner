import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx, Tx } from "@/db/client";
import { accounts, children, memberships, notifications, outbox, reservations } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { allDayInterval, localToInstant } from "@/domain/time";
import type { CommandContext } from "../pipeline";

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-24.");
export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 19:30.");
export const shortText = (max: number) => z.string().trim().max(max);
export const requiredText = (max: number, label: string) => z.string().trim().min(1, `${label} is required.`).max(max);
export const minor = z.number().int().min(0).max(100_000_000);
export const disambiguation = z.enum(["earlier", "later"]).optional();

export const spanSchema = z.object({
  allDay: z.boolean().default(false),
  startDate: dateString,
  startTime: timeString.optional(),
  /** Timed: the end date (often the same day). All-day: the last day, inclusive. */
  endDate: dateString,
  endTime: timeString.optional(),
  startChoice: disambiguation,
  endChoice: disambiguation,
});
export type SpanInput = z.infer<typeof spanSchema>;

export interface ResolvedSpan {
  start: number;
  end: number;
  localStart: string;
  durationMinutes: number;
  allDay: boolean;
}

export function resolveSpan(span: SpanInput, timeZone: string): ResolvedSpan {
  if (span.allDay) {
    const endExclusive = new Date(Date.parse(`${span.endDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const i = allDayInterval(span.startDate, endExclusive, timeZone);
    const days = Math.round((Date.parse(endExclusive) - Date.parse(span.startDate)) / 86_400_000);
    return { ...i, localStart: `${span.startDate}T00:00`, durationMinutes: days * 1440, allDay: true };
  }
  if (!span.startTime || !span.endTime) throw new DomainError("VALIDATION", "Add a start and end time.");
  const localStart = `${span.startDate}T${span.startTime}`;
  const start = localToInstant(localStart, timeZone, span.startChoice);
  const end = localToInstant(`${span.endDate}T${span.endTime}`, timeZone, span.endChoice);
  if (!(end > start)) throw new DomainError("VALIDATION", "The end must be after the start.");
  if (end - start > 14 * 86_400_000) throw new DomainError("VALIDATION", "Events can last up to 14 days.");
  return { start, end, localStart, durationMinutes: Math.round((end - start) / 60_000), allDay: false };
}

export async function currentAdults(tx: DbOrTx, householdId: string): Promise<{ id: string; displayName: string }[]> {
  return tx
    .select({ id: accounts.id, displayName: accounts.displayName })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(eq(memberships.householdId, householdId), isNull(memberships.endsAt)));
}

export async function currentChildIds(tx: Tx, householdId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: children.id })
    .from(children)
    .where(and(eq(children.householdId, householdId), isNull(children.archivedAt)));
  return rows.map((r) => r.id);
}

/** People named in a command must be current members of this household. */
export async function assertPeople(
  ctx: CommandContext,
  adultIds: readonly string[],
  childIds: readonly string[],
): Promise<void> {
  const adults = new Set((await currentAdults(ctx.tx, ctx.household.id)).map((a) => a.id));
  if (adultIds.some((id) => !adults.has(id))) throw new DomainError("VALIDATION", "Someone in this plan is no longer in the household.");
  if (childIds.length) {
    const kids = new Set(await currentChildIds(ctx.tx, ctx.household.id));
    if (childIds.some((id) => !kids.has(id))) throw new DomainError("VALIDATION", "A child in this plan is no longer listed.");
  }
}

export async function reserve(
  tx: Tx,
  householdId: string,
  sourceType: "moment" | "care",
  sourceId: string,
  accountIds: readonly string[],
  start: number,
  end: number,
): Promise<void> {
  if (!accountIds.length) return;
  await tx.insert(reservations).values(
    accountIds.map((accountId) => ({
      householdId,
      accountId,
      sourceType,
      sourceId,
      startAt: new Date(start),
      endAt: new Date(end),
    })),
  );
}

export async function release(tx: Tx, sourceType: "moment" | "care", sourceId: string, accountIds?: readonly string[]): Promise<void> {
  const where = accountIds?.length
    ? and(eq(reservations.sourceType, sourceType), eq(reservations.sourceId, sourceId), inArray(reservations.accountId, [...accountIds]))
    : and(eq(reservations.sourceType, sourceType), eq(reservations.sourceId, sourceId));
  await tx.delete(reservations).where(where);
}

/** Supersede pending deliveries about a source so stale reminders never fire (AT-21). */
export async function supersedeDeliveries(tx: Tx, sourceId: string, kind?: string): Promise<void> {
  await tx
    .update(outbox)
    .set({ state: "superseded", processedAt: new Date() })
    .where(
      and(
        eq(outbox.state, "pending"),
        sql`${outbox.payload}->>'sourceId' = ${sourceId}`,
        kind ? sql`${outbox.payload}->>'kind' = ${kind}` : undefined,
      ),
    );
}

/**
 * Queue an in-app notification. Delivery happens after commit through the
 * outbox, and the worker re-checks the source before delivering.
 */
export async function queueNotification(
  ctx: Pick<CommandContext, "emit" | "household">,
  input: {
    recipientId: string;
    kind: string;
    text: string;
    sourceType: string;
    sourceId: string;
    sourceVersion: number;
    availableAt?: Date;
  },
): Promise<void> {
  await ctx.emit(
    "notify",
    `notify:${input.kind}:${input.sourceId}:${input.sourceVersion}:${input.recipientId}`,
    { ...input, householdId: ctx.household.id, availableAt: undefined },
    input.availableAt,
  );
}

export async function deliverNow(tx: Tx, n: typeof notifications.$inferInsert): Promise<void> {
  await tx.insert(notifications).values(n).onConflictDoNothing({ target: notifications.dedupeKey });
}
