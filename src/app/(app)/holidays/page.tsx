import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { HolidayBoard } from "@/components/holiday-board";
import { mondayOf } from "@/components/format";
import { loadWeek, requireHousehold } from "@/server/page-data";
import { listHolidays } from "@/server/queries/holidays";
import { upcomingTrips } from "@/server/queries/trips";

export const metadata = { title: "Trips, holidays and care" };

export default async function HolidaysPage(props: PageProps<"/holidays">) {
  const { date, archived } = await props.searchParams;
  const week = await loadWeek(typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? mondayOf(date) : undefined);
  const { db, household } = await requireHousehold();
  const showArchived = archived === "1";
  const holidays = await listHolidays(db, household.id, { archived: showArchived });
  return (
    <AppProvider value={infoFrom(week)}>
      <HolidayBoard week={week} holidays={holidays.holidays} showingArchived={showArchived} trips={await upcomingTrips(db, household.id)} />
    </AppProvider>
  );
}
