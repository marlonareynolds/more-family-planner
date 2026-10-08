import { and, eq, isNull } from "drizzle-orm";
import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { Welcome } from "@/components/welcome";
import { calendarFeeds, deskItems, events, holidayPeriods } from "@/db/schema";
import { deskAiEnabled } from "@/server/desk-ai";
import { loadRange } from "@/server/page-data";

export const metadata = { title: "Welcome" };

/**
 * First fifteen minutes (spec 6.4): fill the week before asking for anything
 * else, so the first real screen has something in it.
 */
export default async function WelcomePage() {
  const { view, db, actor, household } = await loadRange(0, 7);
  const [holiday] = await db.select({ id: holidayPeriods.id }).from(holidayPeriods).where(and(eq(holidayPeriods.householdId, household.id), isNull(holidayPeriods.archivedAt))).limit(1);
  const [work] = await db.select({ id: events.id }).from(events).where(and(eq(events.householdId, household.id), eq(events.ownerId, actor.accountId), isNull(events.cancelledAt), isNull(events.feedId))).limit(1);
  const [feed] = await db.select({ id: calendarFeeds.id }).from(calendarFeeds).where(eq(calendarFeeds.accountId, actor.accountId)).limit(1);
  const [letter] = await db.select({ id: deskItems.id }).from(deskItems).where(and(eq(deskItems.householdId, household.id), eq(deskItems.createdBy, actor.accountId))).limit(1);
  return (
    <AppProvider value={infoFrom(view)}>
      <Welcome has={{ children: view.children.length > 0, holidays: !!holiday, work: !!work, calendar: !!feed, partner: view.adults.length > 1, letters: !!letter }} ai={deskAiEnabled()} />
    </AppProvider>
  );
}
