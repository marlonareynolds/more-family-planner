import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { WeekBoard } from "@/components/week-board";
import { loadWeek } from "@/server/page-data";

export const metadata = { title: "Our Week" };

export default async function WeekPage(props: PageProps<"/week">) {
  const { w } = await props.searchParams;
  const week = await loadWeek(w);
  return (
    <AppProvider value={infoFrom(week)}>
      <WeekBoard week={week} />
    </AppProvider>
  );
}
