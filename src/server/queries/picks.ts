import { and, eq, gt, isNull, ne, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, checkins, children, helpers, memberships, moments } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import type { SuggestedTime } from "@/domain/free-time";
import { choosePicks, pairSlots, slotMinutes } from "@/domain/picks";
import { currentWeekKey } from "@/domain/time";
import { catalogueSeat, matchActivities, type Activity, type AgeBand } from "@/lib/catalogue";
import { placeActivities } from "@/lib/places";
import { myShare } from "@/lib/private-split";
import type { Actor } from "../auth";
import { freeTimesFor, heavyWeek } from "./free-time";
import { guidanceFor } from "./learning";
import { placesFor } from "./places";
import { usShelf } from "./shelf";
import { householdFor } from "./week";

export interface WeekPick {
  activity: Pick<Activity, "key" | "title" | "summary" | "simpler" | "typicalCostMinor" | "durationMinutes" | "weatherSensitive" | "backup" | "accessNotes" | "category" | "local" | "location">;
  /** Use the shorter version: a heavy week or the viewer asked for it. */
  simpler: boolean;
  slot: SuggestedTime | null;
  /** Who could look after the children, when they'd need it. */
  carer: { kind: "arranged" | "pending" | "partner" | "helper" | "none" | "not_needed"; name: string | null; helperId: string | null };
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
  // This adult's own "what would help" from this week's private check-in:
  // scoped to the week it was given for, read for nobody else's picks.
  const [checkin] = await db
    .select({ wants: checkins.wants })
    .from(checkins)
    .where(and(eq(checkins.accountId, actor.accountId), eq(checkins.weekKey, currentWeekKey(household.timeZone, now.getTime()))));
  const moreOf = checkin?.wants ?? [];
  const recentRows = await db
    .select({ key: moments.activityKey })
    .from(moments)
    // Only plans this viewer can see: a partner's private draft changes nothing here.
    .where(and(eq(moments.householdId, household.id), eq(moments.kind, kind), gt(moments.startAt, new Date(now.getTime() - 28 * 86_400_000)), ne(moments.lifecycle, "cancelled"), or(eq(moments.organiserId, actor.accountId), eq(moments.sharing, "shared"))));
  const recent = new Set(recentRows.map((r) => r.key).filter((k): k is string => !!k));

  // The household's own places come first; the general catalogue fills in.
  const own = placeActivities(await placesFor(db, household.id), kind);
  const general = matchActivities({ kind, childAgeBands: [...new Set(kids.map((k) => k.ageBand as AgeBand))] });
  // For Us ideas are private to each partner: each adult only ever sees their
  // own half, so neither is shown what the other was. Places and the general
  // catalogue are dealt separately so each keeps its shelf.
  // Ideas a partner has already used stay theirs (R07).
  const shelf = kind === "us" ? await usShelf(db, household.id, actor.accountId, adults.map((a) => a.id)) : null;
  const share = <T extends { key: string }>(list: T[]) => (shelf ? myShare(list, (a) => a.key, shelf, (a) => catalogueSeat(a.key)) : list);
  const candidates = [...share(own), ...share(general)].filter((a) => slotMinutes(a) !== null);
  const week = currentWeekKey(household.timeZone, now.getTime());
  const seed = kind === "us" ? `${household.id}:${actor.accountId}:${week}` : `${household.id}:${week}`;
  const chosen = choosePicks({ candidates, guidance, recent, lighterWeek, moreOf, seed, count });

  // One free-time search per length and time of day, shared between picks.
  const cache = new Map<string, Awaited<ReturnType<typeof freeTimesFor>>>();
  const keyOf = (a: (typeof chosen)[number]) => `${slotMinutes(a)}|${a.startBetween?.join("-") ?? ""}`;
  for (const a of chosen) {
    if (!cache.has(keyOf(a))) cache.set(keyOf(a), await freeTimesFor(db, actor, kind, slotMinutes(a)!, from, days, a.startBetween));
  }
  const slots = pairSlots(chosen, (a) => cache.get(keyOf(a))?.slots ?? []);
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
        : care === "arranged" ? { kind: "arranged", name: null, helperId: null }
        : care === "pending" ? { kind: "pending", name: null, helperId: null }
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
