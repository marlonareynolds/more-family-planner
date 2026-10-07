import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { BalanceCard } from "@/components/balance-card";
import { WeekBoard } from "@/components/week-board";
import { getDb } from "@/db/client";
import { currentActor } from "@/server/auth";
import { loadWeek } from "@/server/page-data";
import { balanceFor } from "@/server/queries/balance";
import { freeTogetherIn } from "@/server/queries/free-time";

export const metadata = { title: "Our Week" };

export default async function WeekPage(props: PageProps<"/week">) {
  const { w } = await props.searchParams;
  const week = await loadWeek(w);
  const actor = (await currentActor())!;
  const db = await getDb();
  const balance = await balanceFor(db, actor, week.household.id);
  // Evenings free for you both, as a fact both of you see.
  const freeTogether = await freeTogetherIn(db, actor, week);
  return (
    <AppProvider value={infoFrom(week)}>
      <WeekBoard week={week} freeTogether={freeTogether} />
      <BalanceCard balance={balance} />
    </AppProvider>
  );
}
