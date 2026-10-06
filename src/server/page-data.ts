import "server-only";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { currentWeekKey, isWeekKey, instantToLocalDate } from "@/domain/time";
import { currentActor } from "./auth";
import { getProjection, getWeek, householdFor } from "./queries/week";

/** Signed-in adult with a household, or a redirect to the right place. */
export async function requireHousehold() {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in");
  const db = await getDb();
  const household = await householdFor(db, actor);
  if (!household) redirect("/setup");
  return { actor, db, household };
}

export async function loadWeek(weekParam?: string | string[]) {
  const { actor, db, household } = await requireHousehold();
  const requested = typeof weekParam === "string" && isWeekKey(weekParam) ? weekParam : currentWeekKey(household.timeZone);
  return getWeek(db, actor, requested);
}

/** From today for `days` days, for Today and the upcoming lists. */
export async function loadUpcoming(days: number) {
  const { actor, db, household } = await requireHousehold();
  return getProjection(db, actor, instantToLocalDate(Date.now(), household.timeZone), days);
}

/** A window around today, for lists that need recent history and what's next. */
export async function loadRange(offsetDays: number, days: number) {
  const { actor, db, household } = await requireHousehold();
  const today = instantToLocalDate(Date.now(), household.timeZone);
  const from = new Date(Date.parse(`${today}T12:00:00Z`) + offsetDays * 86_400_000).toISOString().slice(0, 10);
  return { view: await getProjection(db, actor, from, days), actor, db, household };
}
