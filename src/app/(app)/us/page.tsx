import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { Ideas } from "@/components/ideas";
import { MomentList } from "@/components/moment-list";
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
      <details className="mt-8 rounded-2xl border border-line p-4">
        <summary className="cursor-pointer font-display text-xl">All ideas</summary>
        <Ideas kind="us" guidance={guidance.effective} lighterWeek={await heavyWeek(db, actor, view.household.timeZone)} />
      </details>
    </AppProvider>
  );
}
