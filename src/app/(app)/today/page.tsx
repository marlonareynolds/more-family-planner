import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { TodayView } from "@/components/today-view";
import { loadUpcoming } from "@/server/page-data";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const upcoming = await loadUpcoming(14);
  return (
    <AppProvider value={infoFrom(upcoming)}>
      <TodayView data={upcoming} />
    </AppProvider>
  );
}
