import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { BalanceCard } from "@/components/balance-card";
import { WeekBoard } from "@/components/week-board";
import { getDb } from "@/db/client";
import { currentActor } from "@/server/auth";
import { loadWeek } from "@/server/page-data";
import { balanceFor } from "@/server/queries/balance";

export const metadata = { title: "Our Week" };

export default async function WeekPage(props: PageProps<"/week">) {
  const { w } = await props.searchParams;
  const week = await loadWeek(w);
  const actor = (await currentActor())!;
  const balance = await balanceFor(await getDb(), actor, week.household.id);
  return (
    <AppProvider value={infoFrom(week)}>
      <WeekBoard week={week} />
      <BalanceCard balance={balance} />
    </AppProvider>
  );
}
