import { eq } from "drizzle-orm";
import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { TodayView } from "@/components/today-view";
import { deskItems } from "@/db/schema";
import { loadRange } from "@/server/page-data";
import { jobsFor } from "@/server/queries/jobs";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const { view, db, actor, household } = await loadRange(0, 14);
  const [desk] = await db.select({ id: deskItems.id }).from(deskItems).where(eq(deskItems.householdId, household.id)).limit(1);
  return (
    <AppProvider value={infoFrom(view)}>
      <TodayView data={view} jobs={await jobsFor(db, actor)} deskUsed={!!desk} />
    </AppProvider>
  );
}
