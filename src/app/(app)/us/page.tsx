import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { DateNightTeaser } from "@/components/date-night";
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
      <MomentList data={view} kind="us" title="For Us" intro="Time for the two of you that fits the week: agreed together, childcare sorted, spending clear." lead={<DateNightTeaser key="date-night" />} />
      <details className="mt-8 rounded-[14px] border border-line bg-surface p-4">
        <summary className="cursor-pointer font-display text-xl italic">Your ideas</summary>
        {view.adults.length > 1 && <p className="mt-2 text-sm text-ink-3">Only you see these. {view.adults.find((a) => a.id !== view.me.id)?.displayName ?? "Your partner"} has a different set, so whatever you send comes from you.</p>}
        <Ideas kind="us" guidance={guidance.effective} lighterWeek={await heavyWeek(db, actor, view.household.timeZone)} />
      </details>
    </AppProvider>
  );
}
