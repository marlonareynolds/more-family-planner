import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { Ideas } from "@/components/ideas";
import { MomentList } from "@/components/moment-list";
import { loadRange } from "@/server/page-data";
import { lookBackFor } from "@/server/queries/look-back";
import { OneToOne } from "@/components/one-to-one";
import { heavyWeek } from "@/server/queries/free-time";
import { guidanceFor } from "@/server/queries/learning";

export const metadata = { title: "Family" };

export default async function FamilyPage() {
  const { view, db, actor } = await loadRange(-28, 84);
  const guidance = await guidanceFor(db, actor);
  const month = new Date().toISOString().slice(0, 7);
  const { oneToOne } = await lookBackFor(db, actor, month);
  return (
    <AppProvider value={infoFrom(view)}>
      <MomentList data={view} kind="family" title="Family" intro="Shared moments, small rituals and one-to-one time that suit everyone's ages and energy." />
      <OneToOne pairs={oneToOne} />
      <details className="mt-8 rounded-2xl border border-line p-4">
        <summary className="cursor-pointer font-display text-xl">All ideas</summary>
        <Ideas kind="family" guidance={guidance.effective} lighterWeek={await heavyWeek(db, actor, view.household.timeZone)} />
      </details>
    </AppProvider>
  );
}
