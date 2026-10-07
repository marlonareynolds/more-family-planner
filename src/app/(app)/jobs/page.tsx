import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { JobsBoard } from "@/components/jobs";
import { loadRange } from "@/server/page-data";
import { jobsFor } from "@/server/queries/jobs";

export const metadata = { title: "Household jobs" };

export default async function JobsPage() {
  const { view, db, actor } = await loadRange(0, 1);
  return (
    <AppProvider value={infoFrom(view)}>
      <JobsBoard data={await jobsFor(db, actor)} />
    </AppProvider>
  );
}
