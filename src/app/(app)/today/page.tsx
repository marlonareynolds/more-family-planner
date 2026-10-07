import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { TodayView } from "@/components/today-view";
import { loadRange } from "@/server/page-data";
import { jobsFor } from "@/server/queries/jobs";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const { view, db, actor } = await loadRange(0, 14);
  return (
    <AppProvider value={infoFrom(view)}>
      <TodayView data={view} jobs={await jobsFor(db, actor)} />
    </AppProvider>
  );
}
