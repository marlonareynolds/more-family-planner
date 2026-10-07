import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { PlacesBoard } from "@/components/places";
import { loadRange } from "@/server/page-data";

export const metadata = { title: "Our places" };

export default async function PlacesPage() {
  const { view } = await loadRange(0, 1);
  return (
    <AppProvider value={infoFrom(view)}>
      <PlacesBoard />
    </AppProvider>
  );
}
