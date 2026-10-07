import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { moments, reservations } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import type { Interval } from "@/domain/intervals";
import type { CommandContext } from "../pipeline";
import { currentAdults } from "./helpers";

/**
 * Me time is defended (blueprint, Me): nobody else can put an adult into
 * something that lands on their agreed time for themselves. They are asked
 * first instead. Your own time you can always book over; Today then asks you
 * whether to move it.
 */
export async function assertOwnTimeRespected(ctx: CommandContext, adultIds: readonly string[], spans: readonly Interval[]): Promise<void> {
  const others = adultIds.filter((id) => id !== ctx.actor.accountId);
  if (!others.length || !spans.length) return;
  const from = Math.min(...spans.map((s) => s.start));
  const to = Math.max(...spans.map((s) => s.end));
  const rows = await ctx.tx
    .select({ accountId: reservations.accountId, start: reservations.startAt, end: reservations.endAt })
    .from(reservations)
    .innerJoin(moments, eq(moments.id, reservations.sourceId))
    .where(
      and(
        eq(reservations.householdId, ctx.household.id),
        eq(reservations.sourceType, "moment"),
        eq(moments.kind, "me"),
        inArray(reservations.accountId, others),
        lt(reservations.startAt, new Date(to)),
        gt(reservations.endAt, new Date(from)),
      ),
    );
  const hit = rows.find((r) => spans.some((s) => s.start < r.end.getTime() && s.end > r.start.getTime()));
  if (!hit) return;
  const name = (await currentAdults(ctx.tx, ctx.household.id)).find((a) => a.id === hit.accountId)?.displayName ?? "your partner";
  throw new DomainError("CONFLICT", `That's during ${name}'s own time. Ask ${name} first, or leave them out of this one.`, {
    conflicts: [{ code: "own_time", personId: hit.accountId, start: hit.start.getTime(), end: hit.end.getTime() }],
  });
}
