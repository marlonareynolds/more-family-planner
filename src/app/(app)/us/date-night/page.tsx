import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { DateNightConcierge } from "@/components/date-night";
import { loadRange } from "@/server/page-data";
import { conciergeStarts } from "@/server/queries/needs";

export const metadata = { title: "Date night" };

export default async function DateNightPage() {
  const { view, db, actor } = await loadRange(0, 14);
  // Only positions reach the browser: where each course list starts this week.
  const starts = await conciergeStarts(db, { viewerId: actor.accountId, householdId: view.household.id, adultIds: view.adults.map((a) => a.id), timeZone: view.household.timeZone, places: view.places });
  return (
    <AppProvider value={infoFrom(view)}>
      <DateNightConcierge starts={starts} />
    </AppProvider>
  );
}
