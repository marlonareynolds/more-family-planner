import { and, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { TodayView } from "@/components/today-view";
import { calendarFeeds, deskItems, events, holidayPeriods } from "@/db/schema";
import { loadRange } from "@/server/page-data";
import { decisionsFor } from "@/server/queries/decisions";
import { jobsFor } from "@/server/queries/jobs";
import { easyDinnerOffers, mealsFor } from "@/server/queries/meals";
import { reviewRange } from "@/server/queries/review-range";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const { view, db, actor, household } = await loadRange(0, 14);
  const now = new Date();
  const jobs = await jobsFor(db, actor, now);
  // The same open decisions the weekly review shows, over the same span.
  const range = reviewRange(now, household.timeZone);
  const decisions = { items: decisionsFor(view, jobs, range, now), until: range.lastDay };
  const meals = await mealsFor(db, actor, range.from, 1, now);
  const [desk] = await db.select({ id: deskItems.id }).from(deskItems).where(eq(deskItems.householdId, household.id)).limit(1);
  // Left out of the first-run steps; offered here as optional cards.
  const [holiday] = await db.select({ id: holidayPeriods.id }).from(holidayPeriods).where(and(eq(holidayPeriods.householdId, household.id), isNull(holidayPeriods.archivedAt))).limit(1);
  const [work] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.householdId, household.id), eq(events.ownerId, actor.accountId), isNotNull(events.rule), isNull(events.cancelledAt), isNull(events.feedId), ilike(events.title, "work%")))
    .limit(1);
  const [feed] = await db.select({ id: calendarFeeds.id }).from(calendarFeeds).where(eq(calendarFeeds.accountId, actor.accountId)).limit(1);
  const later = { holidays: !holiday, work: !work && !feed, calendar: !feed };
  return (
    <AppProvider value={infoFrom(view)}>
      <TodayView data={view} jobs={jobs} decisions={decisions} deskUsed={!!desk} meals={meals} dinnerOffer={easyDinnerOffers(view, meals)[meals.today]} later={later} />
    </AppProvider>
  );
}
