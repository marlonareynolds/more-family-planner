import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, children, helpers, memberships, moments } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import type { SuggestedTime } from "@/domain/free-time";
import { choosePicks, pairSlots, slotMinutes } from "@/domain/picks";
import { currentWeekKey } from "@/domain/time";
import { matchActivities, type Activity, type AgeBand } from "@/lib/catalogue";
import { placeActivities } from "@/lib/places";
import type { Actor } from "../auth";
import { freeTimesFor, heavyWeek } from "./free-time";
import { guidanceFor } from "./learning";
import { placesFor } from "./places";
import { householdFor } from "./week";

export interface WeekPick {
  activity: Pick<Activity, "key" | "title" | "summary" | "simpler" | "typicalCostMinor" | "durationMinutes" | "weatherSensitive" | "backup" | "accessNotes" | "category" | "local" | "location">;
  /** Use the shorter version: a heavy week or the viewer asked for it. */
  simpler: boolean;
  slot: SuggestedTime | null;
  /** Who could look after the children, when they'd need it. */
  carer: { kind: "partner" | "helper" | "none" | "not_needed"; name: string | null; helperId: string | null };
}

export interface WeekPicks {
  kind: "me" | "us" | "family";
  picks: WeekPick[];
  lighterWeek: boolean;
  uncertainFor: string[];
}

export async function picksFor(
  db: Db,
  actor: Actor,
  kind: "me" | "us" | "family",
  now = new Date(),
  opts: { count?: number; days?: number; from?: Date } = {},
): Promise<WeekPicks> {
  const count = opts.count ?? 3;
  const days = opts.days ?? 14;
  const from = opts.from && opts.from > now ? opts.from : now;
  const household = await householdFor(db, actor);
  if (!household) throw new DomainError("NOT_FOUND", "You are not in a household.");
  const kids = await db.select({ ageBand: children.ageBand }).from(children).where(and(eq(children.householdId, household.id), isNull(children.archivedAt)));
  const adults = await db
    .select({ id: accounts.id, displayName: accounts.displayName })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(eq(memberships.householdId, household.id), isNull(memberships.endsAt)));
  const village = await db.select().from(helpers).where(and(eq(helpers.householdId, household.id), isNull(helpers.archivedAt))).orderBy(helpers.createdAt);
  const guidance = (await guidanceFor(db, actor)).effective as Record<string, { guidance: "allow" | "avoid" | "simplify" }>;
  const lighterWeek = await heavyWeek(db, actor, household.timeZone, now);
  const recentRows = await db
    .select({ key: moments.activityKey })
    .from(moments)
    .where(and(eq(moments.householdId, household.id), eq(moments.kind, kind), gt(moments.startAt, new Date(now.getTime() - 28 * 86_400_000)), ne(moments.lifecycle, "cancelled")));
  const recent = new Set(recentRows.map((r) => r.key).filter((k): k is string => !!k));

  // The household's own places come first; the general catalogue fills in.
  const own = placeActivities(await placesFor(db, household.id), kind);
  const candidates = [...own, ...matchActivities({ kind, childAgeBands: [...new Set(kids.map((k) => k.ageBand as AgeBand))] })].filter((a) => slotMinutes(a) !== null);
  const chosen = choosePicks({ candidates, guidance, recent, lighterWeek, seed: `${household.id}:${currentWeekKey(household.timeZone, now.getTime())}`, count });

  const cache = new Map<number, Awaited<ReturnType<typeof freeTimesFor>>>();
  for (const a of chosen) {
    const mins = slotMinutes(a)!;
    if (!cache.has(mins)) cache.set(mins, await freeTimesFor(db, actor, kind, mins, from, days));
  }
  const slots = pairSlots(chosen, (a) => cache.get(slotMinutes(a)!)?.slots ?? []);
  const partner = adults.find((a) => a.id !== actor.accountId);
  const firstHelper = village[0];

  return {
    kind,
    lighterWeek,
    uncertainFor: [...new Set([...cache.values()].flatMap((c) => c.uncertainFor))],
    picks: chosen.map((a, i) => {
      const slot = slots[i];
      const care = slot?.care;
      const carer: WeekPick["carer"] =
        !kids.length || care === "with_family" || care === "no_children" ? { kind: "not_needed", name: null, helperId: null }
        : care === "partner_free" ? { kind: "partner", name: partner?.displayName ?? null, helperId: null }
        : firstHelper ? { kind: "helper", name: firstHelper.name, helperId: firstHelper.id }
        : { kind: "none", name: null, helperId: null };
      return {
        activity: {
          key: a.key,
          title: a.title,
          summary: a.summary,
          simpler: a.simpler,
          typicalCostMinor: a.typicalCostMinor,
          durationMinutes: a.durationMinutes,
          weatherSensitive: a.weatherSensitive,
          backup: a.backup,
          accessNotes: a.accessNotes,
          category: a.category,
          local: a.local,
          location: a.location,
        },
        simpler: (lighterWeek || guidance[a.key]?.guidance === "simplify") && !!a.simpler,
        slot,
        carer,
      };
    }),
  };
}
