import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { DateNightTeaser } from "@/components/date-night";
import { Ideas } from "@/components/ideas";
import { MomentList } from "@/components/moment-list";
import { KindnessCard, WhatWouldHelp } from "@/components/what-would-help";
import { loadRange } from "@/server/page-data";
import { heavyWeek } from "@/server/queries/free-time";
import { guidanceFor } from "@/server/queries/learning";
import { kindnessCard, myNeeds } from "@/server/queries/needs";

export const metadata = { title: "For Us" };

export default async function UsPage() {
  const { view, db, actor } = await loadRange(-28, 84);
  const guidance = await guidanceFor(db, actor);
  const adultIds = view.adults.map((a) => a.id);
  // Your own needs, and your own kindness card: never anything your partner shared.
  const mine = await myNeeds(db, actor.accountId, adultIds);
  const card = await kindnessCard(db, { viewerId: actor.accountId, householdId: view.household.id, adults: view.adults, timeZone: view.household.timeZone });
  return (
    <AppProvider value={infoFrom(view)}>
      <MomentList data={view} kind="us" title="For Us" intro="Time for the two of you that fits the week: agreed together, childcare sorted, spending clear." lead={<DateNightTeaser key="date-night" />} />
      {card && <KindnessCard card={card} />}
      <details className="mt-8 rounded-[14px] border border-line bg-surface p-4">
        <summary className="cursor-pointer font-display text-xl italic">What would help you</summary>
        <div className="mt-3">
          <WhatWouldHelp mine={mine} />
        </div>
      </details>
      <details className="mt-4 rounded-[14px] border border-line bg-surface p-4">
        <summary className="cursor-pointer font-display text-xl italic">Your ideas</summary>
        {view.adults.length > 1 && <p className="mt-2 text-sm text-ink-3">Only you see these. {view.adults.find((a) => a.id !== view.me.id)?.displayName ?? "Your partner"} has a different set, so whatever you send comes from you.</p>}
        <Ideas kind="us" guidance={guidance.effective} lighterWeek={await heavyWeek(db, actor, view.household.timeZone)} />
      </details>
    </AppProvider>
  );
}
