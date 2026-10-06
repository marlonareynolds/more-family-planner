import { eq } from "drizzle-orm";
import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { SettingsPanel } from "@/components/settings-panel";
import { accounts } from "@/db/schema";
import { loadRange } from "@/server/page-data";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { view, db, actor } = await loadRange(0, 1);
  const [account] = await db.select({ timeZone: accounts.timeZone }).from(accounts).where(eq(accounts.id, actor.accountId));
  return (
    <AppProvider value={infoFrom(view)}>
      <SettingsPanel
        household={view.household}
        openInvite={view.openInvite}
        kids={view.children}
        profile={{ displayName: actor.displayName, timeZone: account?.timeZone ?? view.household.timeZone }}
      />
    </AppProvider>
  );
}
