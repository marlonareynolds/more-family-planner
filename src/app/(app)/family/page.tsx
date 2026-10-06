import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { Ideas } from "@/components/ideas";
import { MomentList } from "@/components/moment-list";
import { SectionTitle } from "@/components/ui";
import { loadRange } from "@/server/page-data";
import { heavyWeek } from "@/server/queries/free-time";
import { guidanceFor } from "@/server/queries/learning";

export const metadata = { title: "Family" };

export default async function FamilyPage() {
  const { view, db, actor } = await loadRange(-28, 84);
  const guidance = await guidanceFor(db, actor);
  return (
    <AppProvider value={infoFrom(view)}>
      <MomentList data={view} kind="family" title="Family" intro="Shared moments, small rituals and one-to-one time that suit everyone's ages and energy." />
      <SectionTitle>Ideas for your family</SectionTitle>
      <Ideas kind="family" guidance={guidance.effective} lighterWeek={await heavyWeek(db, actor, view.household.timeZone)} />
    </AppProvider>
  );
}
