import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { DateNightConcierge } from "@/components/date-night";
import { loadRange } from "@/server/page-data";

export const metadata = { title: "Date night" };

export default async function DateNightPage() {
  const { view } = await loadRange(0, 14);
  return (
    <AppProvider value={infoFrom(view)}>
      <DateNightConcierge />
    </AppProvider>
  );
}
