import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, households, moments, outbox } from "@/db/schema";
import { instantToLocalDate } from "@/domain/time";
import { getProjection } from "./queries/week";

/**
 * Tell an adult, privately, when their own time stops being clear: something
 * new lands on it (an imported meeting, say) or the children's cover for it
 * falls through. Worked out from the same projection Today shows, so the
 * push and the page always agree. Once per clash.
 */
export async function notifyMeClashes(db: Db, now = new Date(), days = 14): Promise<{ queued: number }> {
  const owners = await db
    .selectDistinct({ accountId: moments.organiserId, householdId: moments.householdId, displayName: accounts.displayName, tz: households.timeZone })
    .from(moments)
    .innerJoin(households, eq(households.id, moments.householdId))
    .innerJoin(accounts, eq(accounts.id, moments.organiserId))
    .where(
      and(
        isNull(households.deletedAt),
        eq(moments.kind, "me"),
        eq(moments.lifecycle, "planned"),
        eq(moments.sharing, "shared"),
        gt(moments.startAt, now),
        lt(moments.startAt, new Date(now.getTime() + days * 86_400_000)),
      ),
    );
  let queued = 0;
  for (const o of owners) {
    const view = await getProjection(db, { accountId: o.accountId, displayName: o.displayName }, instantToLocalDate(now.getTime(), o.tz), days + 1, now).catch(() => null);
    if (!view) continue;
    for (const a of view.attention.filter((x) => x.action === "me-clash")) {
      const m = view.moments.find((x) => x.id === a.targetId);
      if (!m) continue;
      const r = await db
        .insert(outbox)
        .values({
          householdId: o.householdId,
          eventType: "notify",
          dedupeKey: `notify:me.clash:${a.key}:${o.accountId}`,
          payload: { recipientId: o.accountId, kind: "me.clash", text: a.text, sourceType: "moment", sourceId: m.id, sourceVersion: m.materialVersion, householdId: o.householdId },
        })
        .onConflictDoNothing({ target: outbox.dedupeKey })
        .returning({ id: outbox.id });
      queued += r.length;
    }
  }
  return { queued };
}
