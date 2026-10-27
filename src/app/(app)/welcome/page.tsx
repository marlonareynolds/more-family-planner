import { and, asc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { Welcome, type WelcomeStep } from "@/components/welcome";
import { calendarFeeds, deskItems, events, holidayPeriods, memberships } from "@/db/schema";
import { deskAiEnabled } from "@/server/desk-ai";
import { loadRange } from "@/server/page-data";

export const metadata = { title: "Welcome" };

const ONE: readonly WelcomeStep[] = ["children", "letters", "holidays", "work", "calendar", "invite"];

/**
 * First minutes (spec 6.4, cut to three steps by the strategy review): fill
 * the week before asking for anything else, so the first real screen has
 * something in it. `?add=holidays` (or work, calendar…) opens one step on
 * its own, from the optional cards on Today.
 */
export default async function WelcomePage(props: PageProps<"/welcome">) {
  const { add } = await props.searchParams;
  const only = typeof add === "string" && (ONE as string[]).includes(add) ? (add as WelcomeStep) : undefined;
  const { view, db, actor, household } = await loadRange(0, 7);
  const [holiday] = await db.select({ id: holidayPeriods.id }).from(holidayPeriods).where(and(eq(holidayPeriods.householdId, household.id), isNull(holidayPeriods.archivedAt))).limit(1);
  const [work] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.householdId, household.id), eq(events.ownerId, actor.accountId), isNotNull(events.rule), isNull(events.cancelledAt), isNull(events.feedId), ilike(events.title, "work%")))
    .limit(1);
  const [feed] = await db.select({ id: calendarFeeds.id }).from(calendarFeeds).where(eq(calendarFeeds.accountId, actor.accountId)).limit(1);
  // Household-wide: letters the inviter added count for the partner too.
  const [letter] = await db.select({ id: deskItems.id }).from(deskItems).where(eq(deskItems.householdId, household.id)).limit(1);
  const [first] = await db.select({ accountId: memberships.accountId }).from(memberships).where(and(eq(memberships.householdId, household.id), isNull(memberships.endsAt))).orderBy(asc(memberships.startsAt)).limit(1);
  return (
    <AppProvider value={infoFrom(view)}>
      <Welcome
        only={only}
        has={{ children: view.children.length > 0, holidays: !!holiday, work: !!work, calendar: !!feed, partner: view.adults.length > 1, letters: !!letter, joined: !!first && first.accountId !== actor.accountId }}
        ai={deskAiEnabled()}
      />
    </AppProvider>
  );
}
