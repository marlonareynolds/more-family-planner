import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { Ideas } from "@/components/ideas";
import { MomentList } from "@/components/moment-list";
import { SectionTitle } from "@/components/ui";
import { loadRange } from "@/server/page-data";
import { heavyWeek } from "@/server/queries/free-time";
import { guidanceFor } from "@/server/queries/learning";

export const metadata = { title: "For Us" };

export default async function UsPage() {
  const { view, db, actor } = await loadRange(-28, 84);
  const guidance = await guidanceFor(db, actor);
  return (
    <AppProvider value={infoFrom(view)}>
      <MomentList data={view} kind="us" title="For Us" intro="Time for the two of you that fits the week: agreed together, childcare sorted, spending clear." />
      <SectionTitle>Ideas</SectionTitle>
      <Ideas kind="us" guidance={guidance.effective} lighterWeek={await heavyWeek(db, actor, view.household.timeZone)} />
    </AppProvider>
  );
}
