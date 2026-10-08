import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { TrialPanel, type TrialAnswer } from "@/components/trial-panel";
import { addDays, currentWeekKey } from "@/domain/time";
import { loadRange } from "@/server/page-data";
import { trialFor, type TrialResponse } from "@/server/queries/trial";

export const metadata = { title: "Trial" };

const plain = (r: TrialResponse): TrialAnswer => ({
  weekKey: r.weekKey, baseline: r.baseline, meMoments: r.meMoments, usMoments: r.usMoments, familyMoments: r.familyMoments,
  minutesInApp: r.minutesInApp, minutesOutside: r.minutesOutside, fairlyAgreed: r.fairlyAgreed, restoredTime: r.restoredTime, lessToCarry: r.lessToCarry, continueChoice: r.continueChoice,
  helped: r.helped, friction: r.friction, shareWithTrial: r.shareWithTrial,
});

export default async function TrialPage() {
  const { view, db, actor, household } = await loadRange(0, 1);
  const trial = await trialFor(db, actor, household.id);
  const thisWeek = currentWeekKey(household.timeZone);
  const lastWeek = addDays(thisWeek, -7);
  return (
    <AppProvider value={infoFrom(view)}>
      <TrialPanel
        data={{
          weeks: [{ key: lastWeek, label: "Last week" }, { key: thisWeek, label: "This week" }],
          mine: trial.mine.map(plain),
          shared: trial.shared.map((r) => ({ ...plain(r), authorName: r.authorName })),
          coverage: trial.coverage,
          events: trial.events,
          activeDays: trial.activeDays,
          since: trial.since,
        }}
      />
    </AppProvider>
  );
}
