import { and, eq, gt, gte, inArray, isNull, lt, or } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { kindnessMarks, needNotes, partnerNeeds } from "@/db/schema";
import { addDays, currentWeekKey, weekInterval } from "@/domain/time";
import { menuStarts, type MenuStarts, type PlaceOption } from "@/lib/date-night";
import { NEEDS, dealKindnesses, kindnessText, type Need } from "@/lib/kindness";
import { privateSeed, unseal } from "../secret-box";

/**
 * What would help (src/lib/kindness.ts). Two reads, kept apart on purpose:
 * - `myNeeds` is the author's own list, for the author only.
 * - `needsShaping` is what other adults shared about the viewer. It never
 *   leaves this module: callers get only finished kindnesses or menu
 *   positions, which look the same with or without a need behind them.
 */

const NOTE_PURPOSE = "need-notes";
const isNeed = (n: string): n is Need => (NEEDS as readonly string[]).includes(n);

export interface MyNeeds {
  needs: { need: Need; shapes: boolean; paused: boolean }[];
  note: string;
}

/** The viewer's own needs and note. `paused`: about someone who has left. */
export async function myNeeds(db: DbOrTx, accountId: string, adultIds: readonly string[]): Promise<MyNeeds> {
  const rows = await db.select().from(partnerNeeds).where(and(eq(partnerNeeds.accountId, accountId), isNull(partnerNeeds.until)));
  const [note] = await db.select().from(needNotes).where(eq(needNotes.accountId, accountId));
  return {
    needs: rows.filter((r) => isNeed(r.need)).map((r) => ({ need: r.need as Need, shapes: r.shapes, paused: !!r.aboutId && !adultIds.includes(r.aboutId) })),
    note: note ? unseal(note.sealed, NOTE_PURPOSE) : "",
  };
}

/**
 * Needs other current adults shared about the viewer that count for the
 * week starting at `weekStart`: set before that week began and not ended
 * before it began. So a change lands on next week's card, never this one.
 */
export async function needsShaping(db: DbOrTx, viewerId: string, adultIds: readonly string[], weekStart: number): Promise<Set<Need>> {
  const others = adultIds.filter((a) => a !== viewerId);
  if (!others.length) return new Set();
  const at = new Date(weekStart);
  const rows = await db
    .select({ need: partnerNeeds.need })
    .from(partnerNeeds)
    .where(
      and(
        inArray(partnerNeeds.accountId, others),
        eq(partnerNeeds.shapes, true),
        or(eq(partnerNeeds.aboutId, viewerId), isNull(partnerNeeds.aboutId)),
        lt(partnerNeeds.since, at),
        or(isNull(partnerNeeds.until), gt(partnerNeeds.until, at)),
      ),
    );
  return new Set(rows.map((r) => r.need).filter(isNeed));
}

export interface KindnessCard {
  weekKey: string;
  partnerName: string | null;
  items: { key: string; text: string; done: boolean }[];
}

/** This week's small kindnesses for the viewer, or null without a partner. */
export async function kindnessCard(
  db: DbOrTx,
  input: { viewerId: string; householdId: string; adults: readonly { id: string; displayName: string }[]; timeZone: string; now?: Date },
): Promise<KindnessCard | null> {
  const adultIds = input.adults.map((a) => a.id);
  const others = input.adults.filter((a) => a.id !== input.viewerId);
  if (!others.length) return null;
  const weekKey = currentWeekKey(input.timeZone, (input.now ?? new Date()).getTime());
  const needs = await needsShaping(db, input.viewerId, adultIds, weekInterval(weekKey, input.timeZone).start);
  const marks = await db
    .select()
    .from(kindnessMarks)
    .where(and(eq(kindnessMarks.accountId, input.viewerId), gte(kindnessMarks.weekKey, addDays(weekKey, -28))));
  const thisWeek = marks.filter((m) => m.weekKey === weekKey);
  const skipped = new Set(thisWeek.filter((m) => m.mark === "skip").map((m) => m.kindnessKey));
  const doneNow = new Set(thisWeek.filter((m) => m.mark === "done").map((m) => m.kindnessKey));
  const rested = new Set(marks.filter((m) => m.weekKey !== weekKey && m.mark === "done").map((m) => m.kindnessKey));
  for (const k of doneNow) rested.delete(k);
  const items = dealKindnesses({
    shelf: { householdId: input.householdId, accountId: input.viewerId, adultIds },
    needs,
    seed: privateSeed(`kindness:${input.viewerId}:${weekKey}`),
    skipped,
    rested,
  });
  const partnerName = others.length === 1 ? others[0].displayName : null;
  return { weekKey, partnerName, items: items.map((k) => ({ key: k.key, text: kindnessText(k, partnerName), done: doneNow.has(k.key) })) };
}

/** Where the viewer's date night lists start this week (date-night.ts `menuStarts`). */
export async function conciergeStarts(
  db: DbOrTx,
  input: { viewerId: string; householdId: string; adultIds: readonly string[]; timeZone: string; places: PlaceOption[]; now?: Date },
): Promise<MenuStarts> {
  const weekKey = currentWeekKey(input.timeZone, (input.now ?? new Date()).getTime());
  const needs = await needsShaping(db, input.viewerId, input.adultIds, weekInterval(weekKey, input.timeZone).start);
  // The same shelf the browser deals from, so positions line up.
  const shelf = { householdId: input.householdId, accountId: input.viewerId, adultIds: input.adultIds };
  return menuStarts({ seed: privateSeed(`menu:${input.viewerId}:${weekKey}`), needs, places: input.places, shelf });
}
