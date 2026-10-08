import { eq } from "drizzle-orm";
import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { TodayView } from "@/components/today-view";
import { deskItems } from "@/db/schema";
import { loadRange } from "@/server/page-data";
import { decisionsFor } from "@/server/queries/decisions";
import { jobsFor } from "@/server/queries/jobs";
import { reviewRange } from "@/server/queries/review-range";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const { view, db, actor, household } = await loadRange(0, 14);
  const now = new Date();
  const jobs = await jobsFor(db, actor, now);
  // The same open decisions the weekly review shows, over the same span.
  const range = reviewRange(now, household.timeZone);
  const decisions = { items: decisionsFor(view, jobs, range, now), until: range.lastDay };
  const [desk] = await db.select({ id: deskItems.id }).from(deskItems).where(eq(deskItems.householdId, household.id)).limit(1);
  return (
    <AppProvider value={infoFrom(view)}>
      <TodayView data={view} jobs={jobs} decisions={decisions} deskUsed={!!desk} />
    </AppProvider>
  );
}
