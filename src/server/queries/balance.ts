import { and, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, careArrangements, memberships, moments, preparationTasks } from "@/db/schema";
import type { Actor } from "../auth";

/**
 * How time and work have been shared lately (spec 8.3): plain totals and a
 * question, never a fairness score. Only agreed or completed plans count;
 * drafts and other private items don't, and no titles are included.
 */
export interface Balance {
  since: string;
  until: string;
  adults: {
    id: string;
    displayName: string;
    /** Hours of time for themselves, done and coming up. */
    meDone: number;
    mePlanned: number;
    /** Hours looking after the children while the other adult was away. */
    careHours: number;
    tasksDone: number;
  }[];
  usHours: number;
  familyHours: number;
  /** A gentle prompt when one adult has had much less time for themselves. */
  question: { forId: string; text: string } | null;
}

const hrs = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;

export async function balanceFor(db: Db, actor: Actor, householdId: string, now = new Date()): Promise<Balance> {
  const from = new Date(now.getTime() - 28 * 86_400_000);
  const to = new Date(now.getTime() + 14 * 86_400_000);
  const adults = await db
    .select({ id: accounts.id, displayName: accounts.displayName })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(eq(memberships.householdId, householdId), isNull(memberships.endsAt)));
  const ms = await db
    .select()
    .from(moments)
    .where(and(eq(moments.householdId, householdId), gt(moments.endAt, from), lt(moments.startAt, to), inArray(moments.lifecycle, ["planned", "completed"])));
  const care = await db
    .select()
    .from(careArrangements)
    .where(and(eq(careArrangements.householdId, householdId), eq(careArrangements.kind, "parent"), eq(careArrangements.state, "confirmed"), gt(careArrangements.endAt, from), lt(careArrangements.startAt, now)));
  const tasks = await db
    .select({ ownerId: preparationTasks.ownerId })
    .from(preparationTasks)
    .where(and(eq(preparationTasks.householdId, householdId), eq(preparationTasks.state, "done"), gt(preparationTasks.doneAt, from)));

  const dur = (m: { startAt: Date; endAt: Date }) => m.endAt.getTime() - m.startAt.getTime();
  // Me time counts once shared, or for its owner; a partner's private draft never does.
  const counted = ms.filter((m) => m.kind !== "me" || m.sharing === "shared" || m.organiserId === actor.accountId);
  const rows = adults.map((a) => {
    const mine = counted.filter((m) => m.kind === "me" && m.organiserId === a.id);
    return {
      id: a.id,
      displayName: a.displayName,
      meDone: hrs(mine.filter((m) => m.endAt <= now).reduce((s, m) => s + dur(m), 0)),
      mePlanned: hrs(mine.filter((m) => m.endAt > now).reduce((s, m) => s + dur(m), 0)),
      careHours: hrs(care.filter((c) => c.responsibleAccountId === a.id).reduce((s, c) => s + Math.min(c.endAt.getTime(), now.getTime()) - Math.max(c.startAt.getTime(), from.getTime()), 0)),
      tasksDone: tasks.filter((t) => t.ownerId === a.id).length,
    };
  });
  const sum = (kind: "us" | "family") => hrs(counted.filter((m) => m.kind === kind && m.endAt <= now).reduce((s, m) => s + dur(m), 0));

  let question: Balance["question"] = null;
  if (rows.length === 2) {
    const [a, b] = rows;
    const total = (r: (typeof rows)[number]) => r.meDone + r.mePlanned;
    const [low, high] = total(a) <= total(b) ? [a, b] : [b, a];
    if (total(high) >= 2 && total(low) * 2 < total(high)) {
      question = {
        forId: low.id,
        text: low.id === actor.accountId ? "You've had less time for yourself lately. Want to find some?" : `${low.displayName} has had less time for themselves lately. Could you cover so they get some?`,
      };
    }
  }
  return { since: from.toISOString().slice(0, 10), until: to.toISOString().slice(0, 10), adults: rows, usHours: sum("us"), familyHours: sum("family"), question };
}
