import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { DeskBoard } from "@/components/desk";
import { loadRange } from "@/server/page-data";

export const metadata = { title: "Household desk" };

export default async function DeskPage() {
  const { view } = await loadRange(0, 1);
  return (
    <AppProvider value={infoFrom(view)}>
      <DeskBoard />
    </AppProvider>
  );
}
