import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { feedback, preferences, suppressions } from "@/db/schema";
import { effectiveGuidance, inferFromFeedback } from "@/domain/learning";
import type { Actor } from "../auth";

/**
 * The viewer's own guidance only. A partner's private feedback never
 * changes what this adult sees, so nothing reveals who said what.
 */
export async function guidanceFor(db: Db, actor: Actor) {
  const fb = await db.select().from(feedback).where(eq(feedback.accountId, actor.accountId)).orderBy(feedback.createdAt);
  const prefs = await db.select().from(preferences).where(eq(preferences.accountId, actor.accountId));
  const sups = await db.select().from(suppressions).where(eq(suppressions.accountId, actor.accountId));
  const inferred = inferFromFeedback(fb.map((f) => ({ id: f.id, activityKey: f.activityKey, enjoyed: f.enjoyed, wantRepeat: f.wantRepeat, effortOk: f.effortOk })));
  const effective = effectiveGuidance(
    prefs.map((p) => ({ activityKey: p.activityKey, guidance: p.guidance })),
    inferred,
    sups.map((s) => ({ activityKey: s.activityKey, evidenceIds: s.evidenceIds })),
  );
  return {
    effective: Object.fromEntries(effective),
    inferred: inferred.map((i) => ({ activityKey: i.activityKey, guidance: i.guidance, reason: i.reason, forgotten: sups.some((s) => s.activityKey === i.activityKey) })),
    explicit: prefs.map((p) => ({ activityKey: p.activityKey, guidance: p.guidance })),
  };
}

export type Guidance = Awaited<ReturnType<typeof guidanceFor>>;
